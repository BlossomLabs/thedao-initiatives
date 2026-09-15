/** Browser-side preparation of an uploaded avatar: centre-crop to a square,
 * shrink, and re-encode so the file always fits the server's limits
 * (PNG/JPG/WEBP, under PFP_MAX_BYTES) whatever the user picked. */

/** Mirrors PFP_MAX_BYTES in api/routes/profile.ts. */
export const AVATAR_MAX_BYTES = 512 * 1024;
/** Avatars are shown at 26-56px, so 512px is plenty for retina screens. */
export const AVATAR_SIDE = 512;

const QUALITIES = [0.9, 0.8, 0.7, 0.55, 0.4];

export interface Crop {
  sx: number;
  sy: number;
  side: number;
}

/** Largest centred square inside a w×h image. */
export function squareCrop(w: number, h: number): Crop {
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

/** Output edge: shrink to the cap, never upscale. */
export const outputSide = (side: number, cap: number): number => Math.min(side, cap);

export type Encoder = (type: string, quality: number) => Promise<Blob | null>;

/**
 * Encode as WEBP, falling back to JPEG where the browser cannot encode WEBP
 * (it hands back a PNG instead), lowering quality until the blob fits.
 */
export async function encodeUnderLimit(encode: Encoder, maxBytes: number): Promise<Blob> {
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const q of QUALITIES) {
      const blob = await encode(type, q);
      if (!blob) throw new Error("Couldn't read that image. Use a PNG, JPG, or WEBP.");
      if (blob.type !== type) break; // unsupported format: try the next one
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error("That image is too large even after shrinking. Try a simpler picture.");
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // Applies EXIF rotation so phone photos come out the right way up.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to the <img> path (e.g. odd formats)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't read that image. Use a PNG, JPG, or WEBP."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Square, shrink and re-encode a user-picked image into an upload-ready file. */
export async function prepareAvatar(
  file: File,
  { side = AVATAR_SIDE, maxBytes = AVATAR_MAX_BYTES } = {},
): Promise<File> {
  const img = await decode(file);
  const w = img.width, h = img.height;
  if (!w || !h) throw new Error("Couldn't read that image. Use a PNG, JPG, or WEBP.");
  const crop = squareCrop(w, h);
  const out = outputSide(crop.side, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images here. Try another browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, out, out);
  if ("close" in img) img.close();
  const blob = await encodeUnderLimit(
    (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q)),
    maxBytes,
  );
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `avatar.${ext}`, { type: blob.type });
}
