import { Hono } from "hono";
import { type Hex, hexToBytes, isHex, verifyTypedData } from "viem";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { verifyCode } from "../../shared/devcon/code.ts";
import { isValidOnchainBallot } from "../../shared/devcon/ballot.ts";
import { voteTypedData } from "../../shared/devcon/typed-data.ts";
import type { Devcon } from "../services/devcon-chain.ts";

const PER_MINUTE = 30;
const PENDING_MS = 10 * 60_000;
const LEASE_MS = 30_000;

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(status, message, { code, ...extra });

/** One relayer send at a time across isolates, so account nonces and the
 * one-per-person check never race. */
async function withRelayer<T>(kv: Deno.Kv, fn: () => Promise<T>): Promise<T> {
  const key = ["devcon", "relayer"];
  const id = crypto.randomUUID();
  for (let tries = 0; tries < 200; tries++) {
    const cur = await kv.get(key);
    if (cur.value === null) {
      const ok = await kv.atomic().check(cur).set(key, id, { expireIn: LEASE_MS }).commit();
      if (ok.ok) {
        try {
          return await fn();
        } finally {
          const now = await kv.get(key);
          if (now.value === id) await kv.atomic().check(now).delete(key).commit();
        }
      }
    }
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  throw fail(503, "busy", "The vote relayer is busy; try again in a moment.");
}

const uint = (v: unknown): bigint | null => {
  if (typeof v !== "string" || !/^\d{1,20}$/.test(v)) return null;
  return BigInt(v);
};

export function devconRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const dc = (): Devcon => {
    if (!deps.devcon) throw fail(503, "off", "The DevCon vote is not configured.");
    return deps.devcon;
  };
  const open = (d: Devcon) => {
    if (deps.now() >= d.manifest.closesAt) throw fail(410, "closed", "Voting has closed.");
  };
  const limit = async (name: string, ip: string | null) => {
    if (!(await deps.db.rateLimit(`devcon-${name}:${ip ?? "?"}`, PER_MINUTE, 60))) {
      throw new HttpError(429, "slow down");
    }
  };
  const codeNumber = async (d: Devcon, code: unknown) => {
    const n = typeof code === "string" ? await verifyCode(code, d.manifest.issuer) : null;
    if (n === null) throw fail(400, "bad_code", "This code doesn't look right.");
    return BigInt(n);
  };

  r.get("/code/:code", async (c) => {
    const d = dc();
    const n = await codeNumber(d, c.req.param("code"));
    const owner = await d.chain.ownerOf(n);
    return c.json({ n: Number(n), claimed: owner !== null, owner });
  });

  r.post("/claim", requireAuth, async (c) => {
    const d = dc();
    await limit("claim", c.var.ip);
    open(d);
    const body = await jsonBody(c, ["code"]);
    const n = await codeNumber(d, body.code);
    const to = c.var.user!.address as Hex;
    if (await d.chain.hasCode(to)) {
      throw fail(422, "smart_wallet", "Use email or a regular wallet for this one.");
    }
    const hash = await withRelayer(deps.db.kv, async () => {
      if ((await d.chain.ownerOf(n)) !== null) {
        throw fail(409, "claimed", "This badge is already taken.");
      }
      if ((await d.chain.balanceOf(to)) > 0n) {
        throw fail(409, "one_per_person", "One badge per person.");
      }
      return await d.chain.send({ fn: "mint", args: [to, n] });
    });
    return c.json({ hash });
  });

  r.post("/ballot", async (c) => {
    const d = dc();
    await limit("ballot", c.var.ip);
    open(d);
    const body = await jsonBody(c, ["tokenId", "nonce", "ballot", "signature"]);
    const tokenId = uint(body.tokenId);
    const nonce = uint(body.nonce);
    const ballot = body.ballot;
    const signature = body.signature;
    if (
      tokenId === null || nonce === null || typeof ballot !== "string" || !isHex(ballot) ||
      typeof signature !== "string" || !isHex(signature) ||
      !isValidOnchainBallot(hexToBytes(ballot), d.manifest.slugs.length)
    ) throw fail(400, "bad_ballot", "That ballot isn't valid.");
    const owner = await d.chain.ownerOf(tokenId);
    if (!owner) throw fail(404, "no_badge", "No such badge.");
    const valid = await verifyTypedData({
      address: owner,
      ...voteTypedData(d.manifest, tokenId, owner, nonce, ballot),
      signature,
    }).catch(() => false);
    if (!valid) throw fail(401, "bad_signature", "The signature doesn't match the badge's owner.");

    const pendingKey = ["devcon", "pending", tokenId.toString(), nonce.toString()];
    const hash = await withRelayer(deps.db.kv, async () => {
      const pending = await deps.db.kv.get<string>(pendingKey);
      if (pending.value) {
        throw fail(409, "pending", "This ballot is already on its way.", { hash: pending.value });
      }
      if (nonce !== (await d.chain.nonceOf(tokenId)) + 1n) {
        throw fail(409, "stale_nonce", "This ballot was replaced; reload to see the latest.");
      }
      const h = await d.chain.send({
        fn: "recordFor",
        args: [tokenId, nonce, ballot as Hex, signature as Hex],
      });
      await deps.db.kv.set(pendingKey, h, { expireIn: PENDING_MS });
      return h;
    });
    return c.json({ hash });
  });

  return r;
}
