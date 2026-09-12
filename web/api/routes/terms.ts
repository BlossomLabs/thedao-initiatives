/**
 * Donation terms: the published versions (read by the terms page and the
 * donate widget) and the acceptance log behind the widget's gate. Publishing
 * is an admin action (routes/admin.ts POST /terms); the site bundle of
 * content/donation-terms.md (app/data/terms.ts) is only the fallback shown
 * while nothing has been published yet.
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import { versionMeta } from "../db/terms.ts";

/** A version id: the content hash, or the `version: YYYY-MM-DD` line of the bundled fallback. */
export const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function termsRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;

  /** The version in force, with its text. 404 until an admin has published one. */
  r.get("/", async (c) => {
    const v = await db.terms.current();
    if (!v) throw new HttpError(404, "no published terms");
    return c.json({ ...versionMeta(v), text: v.text });
  });

  /** Every published version (no text), newest first, plus the current id. */
  r.get("/versions", async (c) => {
    const cur = await db.terms.current();
    return c.json({ current: cur?.id ?? null, versions: await db.terms.list() });
  });

  /** One version with its text, for the "previous versions" pages. */
  r.get("/versions/:id", async (c) => {
    const id = c.req.param("id");
    if (!VERSION_RE.test(id)) throw new HttpError(404, "not found");
    const v = await db.terms.get(id);
    if (!v) throw new HttpError(404, "not found");
    return c.json({ ...versionMeta(v), text: v.text });
  });

  /**
   * Paper trail for the gate: one immutable record per acceptance, anonymous
   * or per wallet. Returns the record id so the donation confirm can attach
   * the transaction hash to it.
   */
  r.post("/accept", async (c) => {
    if (!(await db.rateLimit("terms:" + c.var.ip, 30, 3600))) {
      throw new HttpError(429, "rate limited");
    }
    const body = await jsonBody(c);
    // One char over the cap so an over-long value is refused, not truncated.
    const version = s(body.version, 65);
    if (!VERSION_RE.test(version)) throw new HttpError(400, "bad terms version");
    let address = s(body.address, 64);
    if (address) {
      if (!isAddress(address)) throw new HttpError(400, "bad address");
      address = toChecksum(address);
    }
    const acceptanceId = await db.terms.logAcceptance(version, address, c.var.ip);
    return c.json({ ok: true, acceptanceId });
  });

  return r;
}
