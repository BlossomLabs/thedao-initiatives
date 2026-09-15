import { K } from "./keys.ts";
import type { Session } from "./types.ts";
import { randomNonce, randomToken, sha256Hex } from "../lib/ids.ts";
import { ADMIN_SESSION_TTL_SECS, NONCE_TTL_SECS, SESSION_TTL_SECS } from "../config.ts";

export function sessionsRepo(kv: Deno.Kv, now: () => number) {
  async function issueNonce(): Promise<string> {
    const nonce = randomNonce();
    await kv.set(K.nonce(nonce), { issuedAt: now() }, {
      expireIn: NONCE_TTL_SECS * 1000,
    });
    return nonce;
  }

  /** Single use: true only the first time, and only while unexpired. */
  async function consumeNonce(nonce: string): Promise<boolean> {
    const cur = await kv.get<{ issuedAt: number }>(K.nonce(nonce));
    if (!cur.value) return false;
    if (now() - cur.value.issuedAt > NONCE_TTL_SECS) return false;
    const res = await kv.atomic().check(cur).delete(K.nonce(nonce)).commit();
    return res.ok;
  }

  async function create(
    address: string,
    isAdmin: boolean,
  ): Promise<{ token: string; session: Session }> {
    const token = randomToken();
    const hash = sha256Hex(token);
    const ttl = isAdmin ? ADMIN_SESSION_TTL_SECS : SESSION_TTL_SECS;
    const session: Session = {
      address,
      isAdmin,
      createdAt: now(),
      expiresAt: now() + ttl,
    };
    await kv.atomic()
      .set(K.session(hash), session, { expireIn: ttl * 1000 })
      .set(K.sessionsByAddr(address, hash), true, { expireIn: ttl * 1000 })
      .commit();
    return { token, session };
  }

  async function get(token: string): Promise<Session | null> {
    if (!token) return null;
    const s = (await kv.get<Session>(K.session(sha256Hex(token)))).value;
    if (!s || s.expiresAt <= now()) return null;
    return s;
  }

  async function revoke(token: string): Promise<void> {
    const hash = sha256Hex(token);
    const s = (await kv.get<Session>(K.session(hash))).value;
    const op = kv.atomic().delete(K.session(hash));
    if (s) op.delete(K.sessionsByAddr(s.address, hash));
    await op.commit();
  }

  async function revokeAll(address: string): Promise<number> {
    let n = 0;
    for await (const e of kv.list({ prefix: K.sessionsOf(address) })) {
      const hash = String(e.key[2]);
      await kv.atomic().delete(K.session(hash)).delete(e.key).commit();
      n++;
    }
    return n;
  }

  return { issueNonce, consumeNonce, create, get, revoke, revokeAll };
}
