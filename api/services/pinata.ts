/** Image uploads to Pinata (IPFS). Bounded raster decoding and re-encoding
 * happens before any bytes leave the process; only a CID is stored. */
import type { Config } from "../config.ts";
import { imageExt } from "../lib/validate.ts";
import { normalizeImage } from "../lib/image.ts";

export const UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

export function createPinata(config: Config, f: typeof fetch) {
  const enabled = Boolean(config.pinataJwt);

  /** Returns [cid, null] or [null, user-facing error]. */
  async function uploadImage(
    blob: Uint8Array,
    maxBytes: number,
    name: string,
  ): Promise<[string, null] | [null, string]> {
    if (!enabled) return [null, "Image uploads are not configured."];
    if (blob.length > maxBytes) {
      return [null, `Image must be under ${Math.round(maxBytes / 1024)} KB.`];
    }
    const ext = imageExt(blob);
    if (!ext) return [null, "Use a PNG, JPG, or WEBP image."];
    const clean = await normalizeImage(blob);
    if (!clean) {
      return [
        null,
        "Use a complete, valid PNG, JPG, or WEBP image up to 4096 pixels per side and 4 megapixels.",
      ];
    }
    if (clean.bytes.length > maxBytes) {
      return [null, "The processed image is too large. Use a smaller image."];
    }
    const mime = ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : "image/webp";
    const form = new FormData();
    form.append("file", new Blob([clean.bytes as BlobPart], { type: mime }), `${name}.${ext}`);
    form.append("network", "public");
    form.append("name", `${name}.${ext}`);
    try {
      const res = await f(UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + config.pinataJwt },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return [null, `Upload failed (${res.status}).`];
      const data = await res.json() as { data?: { cid?: string } };
      const cid = String(data.data?.cid ?? "");
      if (!/^[A-Za-z0-9]{40,}$/.test(cid)) return [null, "Upload failed (no CID)."];
      return [cid, null];
    } catch {
      return [null, "Upload failed."];
    }
  }

  return { enabled, uploadImage };
}

export type Pinata = ReturnType<typeof createPinata>;
