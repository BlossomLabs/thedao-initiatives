/**
 * Donation terms: the acceptance log behind the donate widget's gate. The
 * terms themselves are content/donation-terms.md, bundled into the site at
 * build time (app/data/terms.ts); the API never stores them. The widget sends
 * the version it displayed, which is what the paper trail needs to record.
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { isAddress, toChecksum } from "../chain/address.ts";

/** `version: YYYY-MM-DD` in the terms file (any short id is accepted). */
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export function termsRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;

  /** Paper trail for the gate. Anonymous or per wallet (once per address and version). */
  r.post("/accept", async (c) => {
    if (!(await db.rateLimit("terms:" + c.var.ip, 30, 3600))) {
      throw new HttpError(429, "rate limited");
    }
    const body = await jsonBody(c);
    // One char over the cap so an over-long value is refused, not truncated.
    const version = s(body.version, 41);
    if (!VERSION_RE.test(version)) throw new HttpError(400, "bad terms version");
    let address = s(body.address, 64);
    if (address) {
      if (!isAddress(address)) throw new HttpError(400, "bad address");
      address = toChecksum(address);
    }
    await db.terms.logAcceptance(version, address, c.var.ip);
    return c.json({ ok: true });
  });

  return r;
}
