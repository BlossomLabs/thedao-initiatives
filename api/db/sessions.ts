import { K } from "./keys.ts";
import type { Session } from "./types.ts";
import { randomNonce, randomToken, sha256Hex } from "../lib/ids.ts";
import { HttpError } from "../lib/errors.ts";
import { isAddress } from "../chain/address.ts";
import {
  ADMIN_SESSION_IDLE_SECS,
  ADMIN_SESSION_TTL_SECS,
  NONCE_TTL_SECS,
  SESSION_IDLE_SECS,
  SESSION_TTL_SECS,
} from "../config.ts";

type StoredSession =
  & Pick<Session, "address" | "isAdmin" | "createdAt" | "expiresAt">
  & Partial<Pick<Session, "id" | "lastSeenAt" | "addressEpoch" | "globalEpoch">>;
const SESSION_METADATA = ["id", "lastSeenAt", "addressEpoch", "globalEpoch"] as const;

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

  const epochs = (address: string) =>
    kv.getMany<[string, string]>([K.sessionRevocation(address), K.globalSessionRevocation]);

  /** A new authentication atomically replaces the credential presented with it. */
  async function create(
    address: string,
    isAdmin: boolean,
    replacedToken = "",
  ): Promise<{ token: string; session: Session }> {
    const token = randomToken();
    const hash = sha256Hex(token);
    const replacedHash = replacedToken ? sha256Hex(replacedToken) : "";
    const replaced = replacedHash ? await kv.get<Session>(K.session(replacedHash)) : null;
    const ttl = isAdmin ? ADMIN_SESSION_TTL_SECS : SESSION_TTL_SECS;
    for (let attempt = 0; attempt < 5; attempt++) {
      const [addressEpoch, globalEpoch] = await epochs(address);
      const issuedAt = now();
      const session: Session = {
        id: randomToken(16),
        address,
        isAdmin,
        createdAt: issuedAt,
        lastSeenAt: issuedAt,
        expiresAt: issuedAt + ttl,
        addressEpoch: addressEpoch.value ?? "",
        globalEpoch: globalEpoch.value ?? "",
      };
      const op = kv.atomic().check(addressEpoch, globalEpoch)
        .set(K.session(hash), session, { expireIn: ttl * 1000 })
        .set(K.sessionsByAddr(address, hash), true, { expireIn: ttl * 1000 });
      if (replaced) {
        // Check presence, not a previously loaded middleware snapshot. A touch
        // can race this operation; a completed rotation must not be revived.
        const current = await kv.get<Session>(replaced.key);
        if (replaced.value && !current.value) {
          throw new HttpError(409, "Session already replaced; sign in again.");
        }
        op.check(current).delete(current.key);
        if (current.value) op.delete(K.sessionsByAddr(current.value.address, replacedHash));
      }
      if ((await op.commit()).ok) return { token, session };
    }
    throw new HttpError(409, "Session changed; sign in again.");
  }

  async function byHash(hash: string, touch: boolean): Promise<Session | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await kv.get<StoredSession>(K.session(hash));
      const s = entry.value;
      const time = now();
      if (
        !s || !isAddress(s.address) || typeof s.isAdmin !== "boolean" ||
        !Number.isFinite(s.createdAt) || !Number.isFinite(s.expiresAt) ||
        s.createdAt > time
      ) return null;
      const expiresAt = Math.min(
        s.expiresAt,
        s.createdAt + (s.isAdmin ? ADMIN_SESSION_TTL_SECS : SESSION_TTL_SECS),
      );
      if (expiresAt <= time) return null;
      // Only the original four-field schema qualifies. A damaged/partially
      // upgraded row must never acquire another initial inactivity window.
      const legacy = SESSION_METADATA.every((key) => !Object.hasOwn(s, key));
      const idle = s.isAdmin ? ADMIN_SESSION_IDLE_SECS : SESSION_IDLE_SECS;
      if (
        !legacy && (
          typeof s.id !== "string" || !s.id || !Number.isFinite(s.lastSeenAt) ||
          typeof s.addressEpoch !== "string" || typeof s.globalEpoch !== "string" ||
          s.lastSeenAt! + idle <= time
        )
      ) return null;
      const [addressEpoch, globalEpoch] = await epochs(s.address);
      if (
        legacy
          // Old sessions predate epochs: any revocation marker invalidates
          // them. Attaching the latest epoch would resurrect revoked access.
          ? addressEpoch.versionstamp !== null || globalEpoch.versionstamp !== null
          : s.addressEpoch !== (addressEpoch.value ?? "") ||
            s.globalEpoch !== (globalEpoch.value ?? "")
      ) return null;
      const session: Session = {
        id: legacy ? randomToken(16) : s.id!,
        address: s.address,
        isAdmin: s.isAdmin,
        createdAt: s.createdAt,
        expiresAt,
        // There is no historical activity timestamp to recover. Initialize
        // it once, without renewing the original expiry or authentication age.
        lastSeenAt: legacy ? time : touch ? Math.max(s.lastSeenAt!, time) : s.lastSeenAt!,
        addressEpoch: legacy ? "" : s.addressEpoch!,
        globalEpoch: legacy ? "" : s.globalEpoch!,
      };
      if (!legacy && !touch) return session;
      // CAS checks prevent an in-flight activity update from resurrecting a
      // revoked token, or from crossing a per-wallet/global revocation. The
      // same checks protect migration, even on passive site-lock reads.
      const options = { expireIn: Math.max(1, Math.ceil((expiresAt - time) * 1000)) };
      const op = kv.atomic().check(entry, addressEpoch, globalEpoch)
        .set(entry.key, session, options);
      if (legacy) op.set(K.sessionsByAddr(s.address, hash), true, options);
      if ((await op.commit()).ok) return session;
    }
    return null;
  }

  async function get(token: string, touch = true): Promise<Session | null> {
    return token ? await byHash(sha256Hex(token), touch) : null;
  }

  async function revoke(token: string): Promise<void> {
    const hash = sha256Hex(token);
    const s = (await kv.get<Session>(K.session(hash))).value;
    const op = kv.atomic().delete(K.session(hash));
    if (s) op.delete(K.sessionsByAddr(s.address, hash));
    await op.commit();
  }

  /** Inventory never returns a token, token hash, or another wallet's sessions. */
  async function list(address: string, currentToken = "") {
    const currentHash = currentToken ? sha256Hex(currentToken) : "";
    const sessions = [];
    for await (const entry of kv.list({ prefix: K.sessionsOf(address) })) {
      const hash = String(entry.key[2]);
      const s = await byHash(hash, false);
      if (!s) continue;
      sessions.push({
        id: s.id,
        isAdmin: s.isAdmin,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        current: hash === currentHash,
      });
    }
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function revokeId(address: string, id: string): Promise<boolean> {
    for await (const entry of kv.list({ prefix: K.sessionsOf(address) })) {
      const hash = String(entry.key[2]);
      const s = (await kv.get<Session>(K.session(hash))).value;
      if (s?.id !== id || s.address.toLowerCase() !== address.toLowerCase()) continue;
      await kv.atomic().delete(K.session(hash)).delete(entry.key).commit();
      return true;
    }
    return false;
  }

  async function advanceEpoch(key: Deno.KvKey): Promise<void> {
    // An epoch swap is the revocation point. New authentications check it in
    // their creation transaction; no scan can miss a concurrently issued token.
    await kv.set(key, randomToken(16));
  }

  async function revokeAll(address: string): Promise<number> {
    const known = (await list(address)).length;
    await advanceEpoch(K.sessionRevocation(address));
    return known;
  }

  async function revokeGlobal(): Promise<void> {
    await advanceEpoch(K.globalSessionRevocation);
  }

  return { issueNonce, consumeNonce, create, get, list, revoke, revokeId, revokeAll, revokeGlobal };
}
