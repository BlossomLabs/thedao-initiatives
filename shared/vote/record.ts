import { type Hex, parseSignature, signatureToCompactSignature } from "viem";

/** One vote for SignedBallots.record(): the EIP-712 signature in compact form
 * (r, yParity|s). record() checks it with plain ECDSA, so it works for every
 * key-held wallet, EIP-7702-delegated ones included; recordFor would ask a
 * delegated wallet's code for ERC-1271 instead. */
export function recordVote(
  s: { tokenId: bigint; nonce: bigint; ballot: Hex; signature: Hex },
): { tokenId: bigint; nonce: bigint; r: Hex; vs: Hex; ballot: Hex } {
  const { r, yParityAndS } = signatureToCompactSignature(parseSignature(s.signature));
  return { tokenId: s.tokenId, nonce: s.nonce, r, vs: yParityAndS, ballot: s.ballot };
}
