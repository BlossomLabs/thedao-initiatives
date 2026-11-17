import { BADGE_CONTRACT } from "../config.ts";
import { decodeHexInt, SEL_BALANCE_OF } from "./abi.ts";
import { ethCall, type Rpc } from "./rpc.ts";

export type HasBadge = (
  address: string,
  options?: { throwOnError?: boolean; fresh?: boolean },
) => Promise<boolean>;

/** ERC-721 balanceOf on the badge contract, cached per address for an hour.
 * RPC failure = false (fail closed). Calldata must be lowercase hex: some
 * nodes silently return 0x0 for mixed-case calldata. Restrictions on holders
 * use throwOnError so an outage cannot grant permission, and fresh on writes. */
export function createBadgeChecker(
  rpc: Rpc,
  now: () => number,
  contract = BADGE_CONTRACT,
): HasBadge {
  const cache = new Map<string, [boolean, number]>();
  return async (address, { throwOnError = false, fresh = false } = {}) => {
    const key = address.toLowerCase();
    const hit = cache.get(key);
    if (!fresh && hit && now() - hit[1] < 3600) return hit[0];
    try {
      const data = SEL_BALANCE_OF + "0".repeat(24) + key.replace(/^0x/, "");
      const result = await ethCall(rpc, contract.toLowerCase(), data);
      if (typeof result !== "string" || !/^0x[0-9a-f]{64}$/i.test(result)) {
        throw new Error("Invalid badge balance");
      }
      const held = decodeHexInt(result) > 0n;
      cache.set(key, [held, now()]);
      if (cache.size > 5000) cache.clear();
      return held;
    } catch (error) {
      if (throwOnError) throw error;
      return false;
    }
  };
}
