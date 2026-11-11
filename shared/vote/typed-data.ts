import type { VoteManifest } from "./manifest.ts";

/** EIP-712 `Vote` for SignedBallots (domain BlossomBallots v2). `bytes ballot` is
 * hashed by EIP-712 itself, matching the contract's keccak256(ballot). */
export function voteTypedData(
  m: VoteManifest,
  tokenId: bigint,
  voter: `0x${string}`,
  nonce: bigint,
  ballot: `0x${string}`,
) {
  return {
    domain: {
      name: "BlossomBallots",
      version: "2",
      chainId: m.chainId,
      verifyingContract: m.contract,
    },
    types: {
      Vote: [
        { name: "tokenId", type: "uint256" },
        { name: "voter", type: "address" },
        { name: "nonce", type: "uint64" },
        { name: "ballot", type: "bytes" },
      ],
    },
    primaryType: "Vote",
    message: { tokenId, voter, nonce, ballot },
  } as const;
}
