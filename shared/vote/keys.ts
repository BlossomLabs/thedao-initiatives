import { voteEnvironment } from "./environment.ts";
import type { VoteManifest } from "./manifest.ts";

type RoundIdentity = Pick<VoteManifest, "chainId" | "contract" | "kind">;
/** The same address can name unrelated rounds on different chains. */
export const roundKey = (m: RoundIdentity) =>
  ["vote", voteEnvironment(m), m.chainId, m.contract.toLowerCase()] as const;
export const roundId = (m: RoundIdentity) =>
  `${voteEnvironment(m)}:${m.chainId}:${m.contract.toLowerCase()}`;
/** Old address-only browser entries are ambiguous and are intentionally not reused. */
export const ballotStorageKey = (
  kind: "tiers" | "skipped" | "last",
  m: RoundIdentity,
  tokenId: number | bigint,
) => `vote-${kind}:${roundId(m)}:${tokenId}`;
