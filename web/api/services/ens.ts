/** ENS lookups through ensdata.net with a bounded in-memory LRU. Forward
 * resolution fails CLOSED (returns "") so ownership checks never pass on a
 * failed lookup. */
import { isAddress, toChecksum } from "../chain/address.ts";

const TTL = 3600;
const MAX = 5000;

/** Primary name + avatar of an address ("" when unset). The avatar is only
 * meaningful with a name (it is a text record on the name). */
export interface EnsIdentity {
  name: string;
  avatar: string;
}

const NONE: EnsIdentity = { name: "", avatar: "" };

/** ensdata normalises on-chain avatar records (ipfs://, eip155:… NFTs) to
 * https URLs; anything else is not safe to put in an <img src>. */
function httpsUrl(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 500 ? s : "";
}

export function createEns(f: typeof fetch, now: () => number) {
  const cache = new Map<string, [string | EnsIdentity, number]>();
  const remember = (key: string, val: string | EnsIdentity) => {
    cache.delete(key);
    cache.set(key, [val, now()]);
    while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  };
  const cached = (key: string): string | EnsIdentity | undefined => {
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
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`ensdata ${res.status}`);
    return await res.json();
  }

  /** Primary name (forward-verified) and avatar of an address. */
  async function reverse(address: string): Promise<EnsIdentity> {
    const key = address.toLowerCase();
    const hit = cached(key);
    if (hit !== undefined && typeof hit !== "string") return hit;
    let id = NONE;
    try {
      const data = await lookup(toChecksum(address));
      const name = String(data.ens ?? data.ens_primary ?? "").trim();
      if (name && String(data.address ?? "").toLowerCase() === key) {
        id = { name, avatar: httpsUrl(data.avatar_url) || httpsUrl(data.avatar) };
      }
    } catch { /* best effort */ }
    remember(key, id);
    return id;
  }

  /** Checksummed address a name forward-resolves to, or "". */
  async function forward(name: string): Promise<string> {
    const key = "fwd:" + name.toLowerCase();
    const hit = cached(key);
    if (typeof hit === "string") return hit;
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
