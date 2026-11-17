import type { VoteManifest } from "./manifest.ts";

type RoundIdentity = Pick<VoteManifest, "chainId" | "contract">;
/** The same address can name unrelated rounds on different chains. */
export const roundKey = (m: RoundIdentity) =>
  ["vote", m.chainId, m.contract.toLowerCase()] as const;
export const roundId = (m: RoundIdentity) => `${m.chainId}:${m.contract.toLowerCase()}`;
/** Old address-only browser entries are ambiguous and are intentionally not reused. */
export const ballotStorageKey = (
  kind: "tiers" | "skipped" | "last",
  m: RoundIdentity,
  tokenId: number | bigint,
) => `vote-${kind}:${roundId(m)}:${tokenId}`;
