import { keccak256, toHex } from "viem";
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

/** EIP-712 `Pledge` for SignedBallots.setPledgeBySig: an admin signs, any relayer submits.
 * Same domain as `voteTypedData`. */
export function pledgeTypedData(
  m: VoteManifest,
  p: {
    pledgeId: `0x${string}`;
    initiativeId: bigint;
    currencyId: bigint;
    amount: bigint;
    nonce: bigint;
    deadline: bigint;
  },
) {
  return {
    domain: {
      name: "BlossomBallots",
      version: "2",
      chainId: m.chainId,
      verifyingContract: m.contract,
    },
    types: {
      Pledge: [
        { name: "pledgeId", type: "bytes32" },
        { name: "initiativeId", type: "uint256" },
        { name: "currencyId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Pledge",
    message: p,
  } as const;
}

/** The contract's `pledgeId` for an off-chain pledge record id. */
export function pledgeChainId(id: string): `0x${string}` {
  return keccak256(toHex(`pledge:${id}`));
}
