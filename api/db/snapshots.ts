/**
 * A built value shared by every isolate through KV, so a public read that is
 * expensive to build (the agent feeds) is built once per window for the whole
 * deployment instead of once per isolate. Bytes are split into chunks under
 * the 64 KiB value cap and written in one atomic operation with a TTL; a read
 * checks every chunk carries the head's generation. Not part of backups.
 */
import { K, type ReadOptions } from "./keys.ts";

/** Under Deno KV's 64 KiB value cap, with room for the envelope. */
const CHUNK_BYTES = 60_000;
/** Deno KV's atomic operation cap is 800 KiB in total; leave room for the keys. */
const MAX_BYTES = 760_000;

interface Head {
  generation: string;
  parts: number;
  /** Unix seconds; readers treat the copy as stale after this. */
  until: number;
}
interface Chunk {
  generation: string;
  bytes: Uint8Array;
}

export interface Snapshot {
  bytes: Uint8Array;
  until: number;
}

export function snapshotsRepo(kv: Deno.Kv, now: () => number, read: ReadOptions = undefined) {
  return {
    /** The stored copy inside its window, else null (missing, expired or torn). */
    async get(name: string, origin: string): Promise<Snapshot | null> {
      const head = (await kv.get<Head>(K.snapshotHead(name, origin), read)).value;
      if (!head || head.until <= now()) return null;
      const chunks: Chunk[] = [];
      for (let i = 0; i < head.parts; i += 10) {
        const keys = Array.from(
          { length: Math.min(10, head.parts - i) },
          (_, j) => K.snapshotChunk(name, origin, i + j),
        );
        for (const e of await kv.getMany<Chunk[]>(keys, read)) {
          if (!e.value || e.value.generation !== head.generation) return null;
          chunks.push(e.value);
        }
      }
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.bytes.length, 0));
      let at = 0;
      for (const c of chunks) {
        bytes.set(c.bytes, at);
        at += c.bytes.length;
      }
      return { bytes, until: head.until };
    },
    /** Store a copy for ttlSecs; false when it is too large for one atomic write. */
    async set(name: string, origin: string, bytes: Uint8Array, ttlSecs: number): Promise<boolean> {
      if (bytes.length > MAX_BYTES) return false;
      const generation = crypto.randomUUID();
      const expireIn = ttlSecs * 1000;
      const parts = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
      const op = kv.atomic();
      for (let i = 0; i < parts; i++) {
        const chunk: Chunk = {
          generation,
          bytes: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES),
        };
        op.set(K.snapshotChunk(name, origin, i), chunk, { expireIn });
      }
      const head: Head = { generation, parts, until: now() + ttlSecs };
      op.set(K.snapshotHead(name, origin), head, { expireIn });
      return (await op.commit()).ok;
    },
    /** Drop every origin's copy of `name`. */
    async clear(name: string): Promise<void> {
      const op = kv.atomic();
      let n = 0;
      for await (const e of kv.list({ prefix: K.snapshots(name) })) {
        op.delete(e.key);
        n++;
      }
      if (n) await op.commit();
    },
  };
}
