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
/** Long enough for any mint to land; the chain is the record after that. */
const MINTING_MS = 60 * 60_000;
const BALLOTS_CACHE_SECS = 5;
const DRIP_WEI = 5_000_000_000_000_000n; // 0.005 Sepolia ETH

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
    const kv = deps.db.kv;
    const tokenKey = ["devcon", "minting", "token", n.toString()];
    const addrKey = ["devcon", "minting", "address", to.toLowerCase()];
    // A mint just sent is not on-chain yet: its markers hold the token and the
    // address until it lands, and are dropped if it reverted or was dropped.
    const stillMinting = async (key: Deno.KvKey) => {
      const m = await kv.get<string>(key);
      if (!m.value) return false;
      const status = await d.chain.txStatus(m.value as Hex);
      if (status === "pending" || status === "success") return true;
      await kv.delete(key);
      return false;
    };
    const hash = await withRelayer(kv, async () => {
      if ((await d.chain.ownerOf(n)) !== null || (await stillMinting(tokenKey))) {
        throw fail(409, "claimed", "This badge is already taken.");
      }
      if ((await d.chain.balanceOf(to)) > 0n || (await stillMinting(addrKey))) {
        throw fail(409, "one_per_person", "One badge per person.");
      }
      const h = await d.chain.send({ fn: "mint", args: [to, n] });
      await kv.atomic()
        .set(tokenKey, h, { expireIn: MINTING_MS })
        .set(addrKey, h, { expireIn: MINTING_MS })
        .commit();
      return h;
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

  // "Send it yourself": a voter with no Sepolia ETH gets one small top-up, ever.
  r.post("/gas", requireAuth, async (c) => {
    const d = dc();
    await limit("gas", c.var.ip);
    open(d);
    const body = await jsonBody(c, ["tokenId"]);
    const tokenId = uint(body.tokenId);
    if (tokenId === null) throw fail(400, "bad_badge", "No such badge.");
    const me = c.var.user!.address as Hex;
    const owner = await d.chain.ownerOf(tokenId);
    if (!owner || owner.toLowerCase() !== me.toLowerCase()) {
      throw fail(403, "not_owner", "Only the badge's owner can ask for gas.");
    }
    if ((await d.chain.balance(me)) >= 2n * (await d.chain.estimateRecordFor())) {
      return c.json({ hash: null });
    }
    const kv = deps.db.kv;
    const key = ["devcon", "gas", tokenId.toString()];
    const hash = await withRelayer(kv, async () => {
      // Marked before sending: a failed send never pays twice.
      const marked = await kv.atomic().check({ key, versionstamp: null }).set(key, me).commit();
      if (!marked.ok) throw fail(409, "already_dripped", "This badge already got its gas.");
      return await d.chain.send({ fn: "drip", to: me, value: DRIP_WEI });
    });
    return c.json({ hash });
  });

  // The projector polls this every few seconds; the chain is read at most once per window.
  r.get("/ballots", async (c) => {
    const d = dc();
    const key = ["devcon", "ballots"];
    const cached = await deps.db.kv.get<{ at: number; ballots: unknown[] }>(key);
    if (cached.value && deps.now() - cached.value.at < BALLOTS_CACHE_SECS) {
      return c.json(cached.value);
    }
    const latest = new Map<string, string>();
    for (const b of await d.chain.ballots()) {
      if (b.timestamp >= d.manifest.closesAt) continue;
      // A burn voids the badge's ballots so far (SignedBallots.burn).
      if ("revoked" in b) latest.delete(b.tokenId);
      else latest.set(b.tokenId, b.ballot);
    }
    const ballots = [...latest].map(([tokenId, ballot]) => ({ tokenId, ballot }));
    const value = { at: deps.now(), ballots };
    await deps.db.kv.set(key, value, { expireIn: 60_000 });
    return c.json(value);
  });

  return r;
}
