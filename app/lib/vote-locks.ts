import { bytesToHex, hexToBytes } from "viem";
import { decodeBallot, encodeBallot, type Tier } from "../../shared/vote/ballot";

/** The ballot that counts for a badge, as S/A/B labels: this browser's tiers when they
 * encode to exactly what counts (the chain's ranks can't tell an empty S-Tier from an
 * empty A-Tier), else the chain's reading. */
export function countedTiers(
  acceptedHex: string,
  local: Partial<Record<string, Tier>>,
  slugs: string[],
): Partial<Record<string, Tier>> {
  if (bytesToHex(encodeBallot(slugs, local)).toLowerCase() === acceptedHex.toLowerCase()) {
    return local;
  }
  return decodeBallot(hexToBytes(acceptedHex as `0x${string}`), slugs);
}

export { lockedLabels } from "../../shared/vote/locks";
