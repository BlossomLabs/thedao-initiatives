/** Donation terms: the document, and the acceptance log behind the widget's gate. */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { isAddress, toChecksum } from "../chain/address.ts";

export function termsRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;

  r.get("/", async (c) => {
    const t = await db.terms.get();
    if (!t) throw new HttpError(404, "not found");
    return c.json({ version: t.version, body: t.body });
  });

  /** Paper trail for the gate. Anonymous or per wallet (once per address and version). */
  r.post("/accept", async (c) => {
    if (!(await db.rateLimit("terms:" + c.var.ip, 30, 3600))) {
      throw new HttpError(429, "rate limited");
    }
    const body = await jsonBody(c);
    const version = s(body.version, 40);
    const cur = await db.terms.get();
    if (!version || !cur || version !== cur.version) {
      throw new HttpError(400, "unknown terms version");
    }
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
