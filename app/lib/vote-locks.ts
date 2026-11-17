import { hexToBytes } from "viem";
import { decodeBallot, type Tier } from "../../shared/vote/ballot";

/** Always display the groups the replay counts, even if an older local draft used
 * empty intermediate tiers whose labels were lost during encoding. */
export function countedTiers(
  acceptedHex: string,
  _local: Partial<Record<string, Tier>>,
  slugs: string[],
): Partial<Record<string, Tier>> {
  return decodeBallot(hexToBytes(acceptedHex as `0x${string}`), slugs);
}

export { lockedLabels } from "../../shared/vote/locks";
