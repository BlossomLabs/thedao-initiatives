import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody, s } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { verifySiwe } from "../chain/siwe.ts";
import { isAdminAddress } from "../services/roles.ts";
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
    const signature = s(body.signature, 200);
    if (!message || !signature) {
      throw new HttpError(400, "message and signature are required");
    }
    const [m, err] = await verifySiwe({
      message,
      signature,
      domains: config.siweDomains,
      origins: config.webOrigins,
      chainId: CHAIN_ID,
      now: deps.now(),
      skewSecs: SIWE_CLOCK_SKEW_SECS,
    });
    if (!m) throw new HttpError(401, err);
    if (!(await db.sessions.consumeNonce(m.nonce))) {
      throw new HttpError(401, "nonce invalid or already used");
    }
    const isAdmin = isAdminAddress(config, m.address);
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
