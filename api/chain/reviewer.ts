/** Review identity is the voting NFT, never the wallet holding it. */
import { REVIEW_BADGE_CONTRACT } from "../config.ts";
import { selector } from "./keccak.ts";
import { ethCall, type Rpc } from "./rpc.ts";

const OWNER_OF = selector("ownerOf(uint256)");

/** Fresh ownership checks: the hour-long comment-badge cache is unsuitable for writes. */
export async function ownsReviewToken(
  rpc: Rpc,
  address: string,
  tokenId: string,
): Promise<boolean> {
  const result = await ethCall(
    rpc,
    REVIEW_BADGE_CONTRACT.toLowerCase(),
    OWNER_OF + BigInt(tokenId).toString(16).padStart(64, "0"),
  );
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error("invalid review NFT owner response");
  }
  return result.toLowerCase() === "0x" + address.toLowerCase().slice(2).padStart(64, "0");
}

/** The index finds candidate IDs only. Fresh ownerOf checks authorize every request.
 * This contract is not enumerable; querying its entire transfer history on public
 * RPCs exceeds their block-range limits. Follow the index's pagination instead. */
export async function reviewTokenIds(
  rpc: Rpc,
  address: string,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const base = `https://eth.blockscout.com/api/v2/addresses/${address.toLowerCase()}/nft`;
  let url = new URL(base);
  url.searchParams.set("type", "ERC-721");
  const candidates = new Set<string>();
  const seenPages = new Set<string>();
  for (let page = 0;; page++) {
    if (page >= 50 || seenPages.has(url.href)) throw new Error("review NFT index pagination limit");
    seenPages.add(url.href);
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("review NFT index unavailable");
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error("invalid review NFT index response");
    for (const item of data.items) {
      if (item.token?.address_hash?.toLowerCase() !== REVIEW_BADGE_CONTRACT.toLowerCase()) continue;
      if (typeof item.id !== "string" || !/^\d+$/.test(item.id) || BigInt(item.id) >= 2n ** 256n) {
        throw new Error("invalid review NFT ID");
      }
      candidates.add(BigInt(item.id).toString());
    }
    if (!data.next_page_params) break;
    url = new URL(base);
    url.searchParams.set("type", "ERC-721");
    for (const [key, value] of Object.entries(data.next_page_params)) {
      if (value !== null) url.searchParams.set(key, String(value));
    }
  }
  const ids = [...candidates].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const held = await Promise.all(ids.map((id) => ownsReviewToken(rpc, address, id)));
  return ids.filter((_, i) => held[i]);
}
