/**
 * Uploads that happen before the form is submitted. A backer logo is pinned
 * first and its CID rides the JSON submission; a receipt in KV proves the
 * wallet that submits is the one that uploaded it (a day is plenty).
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireAuth } from "../middleware/auth.ts";
import { ipfsUrl } from "../lib/json.ts";
import { K } from "../db/keys.ts";
import { LOGO_MAX_BYTES, LOGO_UPLOADS_PER_HOUR_PER_ADDRESS } from "../config.ts";

export const UPLOAD_RECEIPT_TTL_MS = 24 * 3600 * 1000;

export interface UploadReceipt {
  address: string;
  at: number;
}

export function uploadRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  /** Multipart `image` (png/jpg/webp, under 1 MB) -> `{cid, logoUrl}`. */
  r.post("/logo", requireAuth, async (c) => {
    const address = c.var.user!.address;
    if (!deps.pinata.enabled) throw new HttpError(503, "Uploads are not enabled.");
    if (
      !(await db.rateLimit(
        "logoup:" + address.toLowerCase(),
        LOGO_UPLOADS_PER_HOUR_PER_ADDRESS,
        3600,
      ))
    ) {
      throw new HttpError(429, "Too many uploads; try again in an hour.");
    }
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File) || !file.size) throw new HttpError(400, "Choose an image.");
    if (file.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
    const [cid, err] = await deps.pinata.uploadImage(
      new Uint8Array(await file.arrayBuffer()),
      LOGO_MAX_BYTES,
      "logo-" + address.slice(0, 10),
    );
    if (!cid) throw new HttpError(400, err ?? "upload failed");
    const receipt: UploadReceipt = { address, at: deps.now() };
    await db.kv.set(K.upload(cid), receipt, { expireIn: UPLOAD_RECEIPT_TTL_MS });
    return c.json({ cid, logoUrl: ipfsUrl(config, cid) });
  });

  return r;
}

/** True when this wallet uploaded the CID within the receipt window. */
export async function ownsUpload(db: Deps["db"], cid: string, address: string): Promise<boolean> {
  const rec = (await db.kv.get<UploadReceipt>(K.upload(cid))).value;
  return Boolean(rec && rec.address.toLowerCase() === address.toLowerCase());
}
