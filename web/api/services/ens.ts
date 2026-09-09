/** ENS lookups through ensdata.net with a bounded in-memory LRU. Forward
 * resolution fails CLOSED (returns "") so ownership checks never pass on a
 * failed lookup. */
import { isAddress, toChecksum } from "../chain/address.ts";

const TTL = 3600;
const MAX = 5000;

export function createEns(f: typeof fetch, now: () => number) {
  const cache = new Map<string, [string, number]>();
  const remember = (key: string, val: string) => {
    cache.delete(key);
    cache.set(key, [val, now()]);
    while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  };
  const cached = (key: string): string | undefined => {
    const hit = cache.get(key);
    if (hit && now() - hit[1] < TTL) {
      cache.delete(key);
      cache.set(key, hit);
      return hit[0];
    }
    return undefined;
  };
  async function lookup(path: string): Promise<Record<string, unknown>> {
    const res = await f("https://api.ensdata.net/" + path, {
      headers: { "User-Agent": "thedao-rfps/2.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`ensdata ${res.status}`);
    return await res.json();
  }

  /** Primary name of an address, forward-verified, or "". */
  async function reverse(address: string): Promise<string> {
    const key = address.toLowerCase();
    const hit = cached(key);
    if (hit !== undefined) return hit;
    let name = "";
    try {
      const data = await lookup(toChecksum(address));
      const cand = String(data.ens ?? data.ens_primary ?? "").trim();
      if (cand && String(data.address ?? "").toLowerCase() === key) name = cand;
    } catch { /* best effort */ }
    remember(key, name);
    return name;
  }

  /** Checksummed address a name forward-resolves to, or "". */
  async function forward(name: string): Promise<string> {
    const key = "fwd:" + name.toLowerCase();
    const hit = cached(key);
    if (hit !== undefined) return hit;
    let addr = "";
    try {
      const data = await lookup(encodeURIComponent(name));
      const cand = String(data.address ?? "").trim();
      if (isAddress(cand)) addr = toChecksum(cand);
    } catch { /* fail closed */ }
    remember(key, addr);
    return addr;
  }

  return {
    reverse,
    forward,
    has: (address: string) => cached(address.toLowerCase()) !== undefined,
  };
}

export type Ens = ReturnType<typeof createEns>;
