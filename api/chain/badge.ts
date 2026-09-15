import { BADGE_CONTRACT } from "../config.ts";
import { decodeHexInt, SEL_BALANCE_OF } from "./abi.ts";
import { ethCall, type Rpc } from "./rpc.ts";

export type HasBadge = (address: string) => Promise<boolean>;

/** ERC-721 balanceOf on the badge contract, cached per address for an hour.
 * RPC failure = false (fail closed). Calldata must be lowercase hex: some
 * nodes silently return 0x0 for mixed-case calldata. */
export function createBadgeChecker(
  rpc: Rpc,
  now: () => number,
  contract = BADGE_CONTRACT,
): HasBadge {
  const cache = new Map<string, [boolean, number]>();
  return async (address) => {
    const key = address.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit[1] < 3600) return hit[0];
    try {
      const data = SEL_BALANCE_OF + "0".repeat(24) + key.replace(/^0x/, "");
      const held = decodeHexInt(await ethCall(rpc, contract.toLowerCase(), data)) > 0n;
      cache.set(key, [held, now()]);
      if (cache.size > 5000) cache.clear();
      return held;
    } catch {
      return false;
    }
  };
}
