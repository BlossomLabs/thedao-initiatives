import { HttpError } from "./errors.ts";

export interface CleanImage {
  bytes: Uint8Array;
  ext: "png" | "jpg" | "webp";
}
let active = 0;

/** ASVS-07: bound decoding memory, concurrency and wall time outside the request thread. */
export function normalizeImage(bytes: Uint8Array): Promise<CleanImage | null> {
  if (active >= 2) throw new HttpError(503, "Image processing is busy. Try again shortly.");
  const worker = new Worker(new URL("./image-worker.ts", import.meta.url).href, { type: "module" });
  active++;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: CleanImage | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      active--;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 8000);
    worker.onmessage = (event: MessageEvent<CleanImage | null>) => finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(null);
    };
    worker.postMessage(bytes);
  });
}
