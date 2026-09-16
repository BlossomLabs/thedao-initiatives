import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth, requireRecentAuth } from "../middleware/auth.ts";
import { jsonBody, s } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { requireClientIp } from "../middleware/ip.ts";
import { auditContext } from "../services/audit.ts";
import { verifySiwe } from "../chain/siwe.ts";
import { selfOrigin } from "../lib/origin.ts";
import { MAX_CONTRACT_SIGNATURE_BYTES } from "../chain/sign.ts";
import { pfpUrl } from "../lib/json.ts";
import { clearSessionCookie, setSessionCookie } from "../lib/session-cookie.ts";
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
    if (!(await db.rateLimit("nonce:" + requireClientIp(c), 30, 60))) {
      throw new HttpError(429, "slow down");
    }
    return c.json({ nonce: await db.sessions.issueNonce() });
  });

  r.post("/verify", async (c) => {
    if (
      !(await db.rateLimit("login:" + requireClientIp(c), LOGIN_ATTEMPTS_PER_MINUTE_PER_IP, 60))
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
    const { token, session } = await db.sessions.create(m.address, isAdmin, c.var.token);
    auditContext(c, {
      actor: session.address,
      target: session.address,
      detail: c.var.user ? "reauthenticate" : "login",
    });
    const info = { address: session.address, isAdmin, expiresAt: session.expiresAt };
    // The browser asks for the cookie and never sees the token; scripts get
    // it in the body and send it back as a bearer.
    if (body.cookie === true) {
      c.header(
        "Set-Cookie",
        setSessionCookie(c.req.raw, token, session.expiresAt - deps.now()),
      );
      return c.json(info);
    }
    return c.json({ token, ...info });
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

  /**
   * One-time migration for sessions minted before the cookie existed: the
   * browser presents its stored bearer once, gets the same session back as the
   * HttpOnly cookie, and forgets the token. The session repository also upgrades
   * old metadata automatically, preserving authentication age and absolute expiry.
   * Remove once every pre-cookie session has expired (SESSION_TTL_SECS after
   * the deploy that introduced the cookie, 2026-09-15).
   */
  r.post("/cookie", requireAuth, (c) => {
    const u = c.var.user!;
    c.header(
      "Set-Cookie",
      setSessionCookie(c.req.raw, c.var.token, u.expiresAt - deps.now()),
    );
    return c.json({ address: u.address, isAdmin: u.isAdmin, expiresAt: u.expiresAt });
  });

  r.post("/logout", requireAuth, async (c) => {
    await db.sessions.revoke(c.var.token);
    c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    return c.json({ ok: true });
  });

  r.get("/sessions", requireAuth, async (c) => {
    return c.json({ sessions: await db.sessions.list(c.var.user!.address, c.var.token) });
  });

  r.delete("/sessions/:id", requireAuth, requireRecentAuth(deps.now), async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new HttpError(400, "Invalid session identifier.");
    if (!(await db.sessions.revokeId(c.var.user!.address, id))) {
      throw new HttpError(404, "Session not found.");
    }
    if (c.var.user!.id === id) {
      c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    }
    return c.json({ ok: true });
  });

  r.post("/logout-all", requireAuth, requireRecentAuth(deps.now), async (c) => {
    const n = await db.sessions.revokeAll(c.var.user!.address);
    c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    return c.json({ ok: true, revoked: n });
  });

  return r;
}
