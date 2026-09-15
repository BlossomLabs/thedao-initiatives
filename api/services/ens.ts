/** ENS lookups: on-chain through the configured mainnet RPC endpoints (viem's
 * universal resolver) with ensdata.net as a fallback when every RPC fails,
 * and a bounded in-memory LRU in front. Forward resolution fails CLOSED
 * (returns "") so ownership checks never pass on a failed lookup. */
import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";
import { getEnsAddress, getEnsAvatar, getEnsName, normalize } from "viem/ens";
import { isAddress, toChecksum } from "../chain/address.ts";

const TTL = 3600;
const MAX = 5000;
const RPC_TIMEOUT_MS = 5000;

/** Primary name + avatar of an address ("" when unset). The avatar is only
 * meaningful with a name (it is a text record on the name). */
export interface EnsIdentity {
  name: string;
  avatar: string;
}

const NONE: EnsIdentity = { name: "", avatar: "" };

/** The three on-chain questions the service asks. `null` is an authoritative
 * "not set"; a thrown error means the answer is unknown (RPC trouble). */
export interface EnsResolver {
  /** Primary (reverse) name of an address. */
  name(address: string): Promise<string | null>;
  /** Address a name forward-resolves to. */
  address(name: string): Promise<string | null>;
  /** Avatar record of a name, already turned into a fetchable URL. */
  avatar(name: string): Promise<string | null>;
}

/** Resolver backed by the ENS universal resolver on mainnet, trying the RPC
 * endpoints in order until one answers. */
export function onchainEns(endpoints: string[], f: typeof fetch = fetch): EnsResolver {
  const client = createPublicClient({
    chain: mainnet,
    transport: fallback(
      endpoints.map((url) =>
        http(url, {
          fetchFn: f,
          fetchOptions: { headers: { "User-Agent": "thedao-rfps/2.0" } },
          timeout: RPC_TIMEOUT_MS,
          retryCount: 0,
        })
      ),
      { rank: false, retryCount: 0 },
    ),
  });
  // An unnormalisable name cannot be anybody's, so it resolves to nothing
  // rather than failing over to the next source.
  const norm = (name: string): string | null => {
    try {
      return normalize(name);
    } catch {
      return null;
    }
  };
  return {
    name: (address) => getEnsName(client, { address: toChecksum(address) as `0x${string}` }),
    address: async (name) => {
      const n = norm(name);
      return n ? await getEnsAddress(client, { name: n }) : null;
    },
    avatar: async (name) => {
      const n = norm(name);
      return n ? await getEnsAvatar(client, { name: n }) : null;
    },
  };
}

/** Only https URLs are safe to put in an <img src>. viem and ensdata both
 * turn ipfs://, ar:// and NFT avatar records into gateway URLs. */
function httpsUrl(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 500 ? s : "";
}

export interface EnsOptions {
  /** On-chain source; without it only ensdata is consulted (tests). */
  onchain?: EnsResolver;
  log?: (msg: string) => void;
}

export function createEns(f: typeof fetch, now: () => number, opts: EnsOptions = {}) {
  const log = opts.log ?? (() => {});
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
  async function ensdata(path: string): Promise<Record<string, unknown>> {
    const res = await f("https://api.ensdata.net/" + path, {
      headers: { "User-Agent": "thedao-rfps/2.0" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`ensdata ${res.status}`);
    return await res.json();
  }

  /** Name + avatar from the chain; `undefined` when the chain could not be asked. */
  async function reverseOnchain(address: string): Promise<EnsIdentity | undefined> {
    const chain = opts.onchain;
    if (!chain) return undefined;
    try {
      const name = (await chain.name(address))?.trim() ?? "";
      if (!name) return NONE;
      const [owner, avatar] = await Promise.all([
        chain.address(name),
        // A broken avatar record must not hide the name.
        chain.avatar(name).catch((e) => {
          log(`ens: avatar lookup failed for ${name}: ${String(e)}`);
          return null;
        }),
      ]);
      if ((owner ?? "").toLowerCase() !== address.toLowerCase()) return NONE;
      return { name, avatar: httpsUrl(avatar) };
    } catch (e) {
      log(`ens: on-chain reverse lookup failed for ${address}: ${String(e)}`);
      return undefined;
    }
  }

  async function reverseEnsdata(address: string): Promise<EnsIdentity> {
    try {
      const data = await ensdata(toChecksum(address));
      const name = String(data.ens ?? data.ens_primary ?? "").trim();
      if (name && String(data.address ?? "").toLowerCase() === address.toLowerCase()) {
        return { name, avatar: httpsUrl(data.avatar_url) || httpsUrl(data.avatar) };
      }
    } catch (e) {
      log(`ens: ensdata reverse lookup failed for ${address}: ${String(e)}`);
    }
    return NONE;
  }

  /** Primary name (forward-verified) and avatar of an address. */
  async function reverse(address: string): Promise<EnsIdentity> {
    const key = address.toLowerCase();
    const hit = cached(key);
    if (hit !== undefined && typeof hit !== "string") return hit;
    const id = (await reverseOnchain(key)) ?? (await reverseEnsdata(key));
    remember(key, id);
    return id;
  }

  /** Checksummed address a name forward-resolves to, or "". */
  async function forward(name: string): Promise<string> {
    const key = "fwd:" + name.toLowerCase();
    const hit = cached(key);
    if (typeof hit === "string") return hit;
    let addr = "";
    let answered = false;
    if (opts.onchain) {
      try {
        const cand = (await opts.onchain.address(name)) ?? "";
        if (isAddress(cand)) addr = toChecksum(cand);
        answered = true;
      } catch (e) {
        log(`ens: on-chain forward lookup failed for ${name}: ${String(e)}`);
      }
    }
    if (!answered) {
      try {
        const data = await ensdata(encodeURIComponent(name));
        const cand = String(data.address ?? "").trim();
        if (isAddress(cand)) addr = toChecksum(cand);
      } catch (e) {
        log(`ens: ensdata forward lookup failed for ${name}: ${String(e)}`);
      }
    }
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
