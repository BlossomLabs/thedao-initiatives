import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody, s } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { verifySiwe } from "../chain/siwe.ts";
import { selfOrigin } from "../lib/origin.ts";
import { MAX_CONTRACT_SIGNATURE_BYTES } from "../chain/sign.ts";
import { pfpUrl } from "../lib/json.ts";
import {
  CHAIN_ID,
  LOGIN_ATTEMPTS_PER_MINUTE_GLOBAL,
  LOGIN_ATTEMPTS_PER_MINUTE_PER_IP,
  SIWE_CLOCK_SKEW_SECS,
} from "../config.ts";

export function authRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  r.get("/nonce", async (c) => {
    if (!(await db.rateLimit("nonce:" + c.var.ip, 30, 60))) {
      throw new HttpError(429, "slow down");
    }
    return c.json({ nonce: await db.sessions.issueNonce() });
  });

  r.post("/verify", async (c) => {
    if (
      !(await db.rateLimit("login:" + c.var.ip, LOGIN_ATTEMPTS_PER_MINUTE_PER_IP, 60))
    ) {
      throw new HttpError(429, "Too many attempts; wait a minute.");
    }
    if (!(await db.rateLimit("login-global", LOGIN_ATTEMPTS_PER_MINUTE_GLOBAL, 60))) {
      throw new HttpError(429, "Too many attempts; wait a minute.");
    }
    const body = await jsonBody(c);
    const message = String(body.message ?? "");
    // EOA signatures are 132 chars; contract signatures (EIP-1271) can be longer.
    const signature = s(body.signature, 2 + 2 * MAX_CONTRACT_SIGNATURE_BYTES);
    if (!message || !signature) {
      throw new HttpError(400, "message and signature are required");
    }
    // The page signs for the host it was loaded on. A platform host (*.deno.net)
    // is accepted alongside the configured list; any other host must be listed,
    // since a bare Host header is not proof the page was served here.
    const self = selfOrigin(c.req.raw, config);
    const [m, err] = await verifySiwe({
      message,
      signature,
      domains: self ? [...config.siweDomains, new URL(self).host] : config.siweDomains,
      origins: self ? [...config.webOrigins, self] : config.webOrigins,
      chainId: CHAIN_ID,
      now: deps.now(),
      skewSecs: SIWE_CLOCK_SKEW_SECS,
      rpc: deps.chain.rpc,
    });
    if (!m) throw new HttpError(401, err);
    if (!(await db.sessions.consumeNonce(m.nonce))) {
      throw new HttpError(401, "nonce invalid or already used");
    }
    const isAdmin = await deps.admins.isAdmin(m.address);
    const { token, session } = await db.sessions.create(m.address, isAdmin);
    return c.json({
      token,
      address: session.address,
      isAdmin,
      expiresAt: session.expiresAt,
    });
  });

  r.get("/me", requireAuth, async (c) => {
    const u = c.var.user!;
    const p = await db.profiles.get(u.address);
    return c.json({
      address: u.address,
      isAdmin: u.isAdmin,
      expiresAt: u.expiresAt,
      nickname: p.nickname || null,
      pfp: p.pfp,
      pfpUrl: pfpUrl(config, p.pfp),
    });
  });

  r.post("/logout", requireAuth, async (c) => {
    await db.sessions.revoke(c.var.token);
    return c.json({ ok: true });
  });

  r.post("/logout-all", requireAuth, async (c) => {
    const n = await db.sessions.revokeAll(c.var.user!.address);
    return c.json({ ok: true, revoked: n });
  });

  return r;
}
