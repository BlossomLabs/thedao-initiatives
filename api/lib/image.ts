import { HttpError } from "./errors.ts";

export interface CleanImage {
  bytes: Uint8Array;
  ext: "png" | "jpg" | "webp";
}

/** ASVS-07: bound decoding memory, concurrency and wall time outside the request thread.
 *
 * Loading and initialising the 15 MB ImageMagick WASM takes seconds on a hosted isolate,
 * so decoders are initialised once and reused: the decode deadline starts only after the
 * worker reports ready, and a worker that misses it is terminated and replaced. */
const MAX_DECODERS = 2;
const INIT_DEADLINE_MS = 60_000;
const DECODE_DEADLINE_MS = 8_000;

interface Decoder {
  worker: Worker;
  ready: Promise<boolean>;
  busy: boolean;
}

const pool: Decoder[] = [];
let spawned = 0;

function drop(d: Decoder): void {
  d.worker.terminate();
  const i = pool.indexOf(d);
  if (i !== -1) pool.splice(i, 1);
}

function spawn(): Decoder {
  const worker = new Worker(new URL("./image-worker.ts", import.meta.url).href, { type: "module" });
  spawned++;
  const d: Decoder = { worker, busy: false, ready: Promise.resolve(false) };
  d.ready = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), INIT_DEADLINE_MS);
    worker.onmessage = (event: MessageEvent<{ ready?: boolean } | null>) => {
      clearTimeout(timer);
      resolve(event.data?.ready === true);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      clearTimeout(timer);
      resolve(false);
    };
  }).then((ok) => {
    if (!ok) drop(d);
    return ok;
  });
  pool.push(d);
  return d;
}

/** Start initialising a decoder now, so the first upload of an isolate does not wait for it. */
export function warmImageWorker(): void {
  if (pool.length === 0) spawn();
}

export function normalizeImage(bytes: Uint8Array): Promise<CleanImage | null> {
  const d = pool.find((d) => !d.busy) ?? (pool.length < MAX_DECODERS ? spawn() : null);
  if (!d) throw new HttpError(503, "Image processing is busy. Try again shortly.");
  d.busy = true;
  return decode(d, bytes);
}

async function decode(d: Decoder, bytes: Uint8Array): Promise<CleanImage | null> {
  if (!(await d.ready)) {
    throw new HttpError(503, "Image processing is unavailable. Try again shortly.");
  }
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: CleanImage | null, reusable: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (reusable) {
        d.worker.onmessage = null;
        d.worker.onerror = null;
        d.busy = false;
      } else {
        drop(d);
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null, false), DECODE_DEADLINE_MS);
    d.worker.onmessage = (event: MessageEvent<CleanImage | null>) => finish(event.data, true);
    d.worker.onerror = (event) => {
      event.preventDefault();
      finish(null, false);
    };
    d.worker.postMessage(bytes);
  });
}

/** Terminate every decoder (tests, shutdown). */
export function closeImageWorkers(): void {
  for (const d of [...pool]) drop(d);
}

export function imageWorkerStats(): { spawned: number; pooled: number } {
  return { spawned, pooled: pool.length };
}
