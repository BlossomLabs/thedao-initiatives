/**
 * Inbound webhooks. Not behind the site lock (see lib/sitelock.ts); each
 * receiver authenticates its caller itself and only ever *triggers* work the
 * server verifies on its own.
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { ALCHEMY_SIGNATURE_HEADER, recipientsOf, signatureOk } from "../services/alchemy.ts";

export function hookRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  /** Alchemy Address Activity: queue a Safe sync for each recipient we know. */
  r.post("/alchemy", async (c) => {
    const key = config.alchemyWebhookSigningKey;
    if (!key) throw new HttpError(404, "not found");
    const body = await c.req.text();
    const sig = c.req.header(ALCHEMY_SIGNATURE_HEADER) ?? "";
    if (!(await signatureOk(key, body, sig))) throw new HttpError(401, "bad signature");
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new HttpError(400, "malformed json");
    }
    const recipients = recipientsOf(payload);
    let queued = 0;
    for (const [address, hashes] of recipients) {
      const rfp = await db.rfps.bySafe(address);
      if (!rfp || rfp.status !== "approved" || !deps.syncQueue) continue;
      await deps.syncQueue.trigger(rfp.id, [...hashes]);
      queued++;
    }
    deps.log(`alchemy hook: ${recipients.size} recipient(s), ${queued} sync(s) queued`);
    return c.json({ ok: true, queued });
  });

  return r;
}
