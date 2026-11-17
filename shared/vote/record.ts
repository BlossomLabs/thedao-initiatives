import { type Hex, parseSignature, signatureToCompactSignature } from "viem";

/** One vote for SignedBallots.record(): the EIP-712 signature in compact form
 * (r, yParity|s). record() checks it with plain ECDSA, so it works for every
 * key-held wallet, EIP-7702-delegated ones included; recordFor would ask a
 * delegated wallet's code for ERC-1271 instead. */
export function recordVote(
  s: { tokenId: bigint; nonce: bigint; ballot: Hex; signature: Hex; proof: number[] },
): { tokenId: bigint; nonce: bigint; r: Hex; vs: Hex; ballot: Hex; proof: number[] } {
  const { r, yParityAndS } = signatureToCompactSignature(parseSignature(s.signature));
  return {
    tokenId: s.tokenId,
    nonce: s.nonce,
    r,
    vs: yParityAndS,
    ballot: s.ballot,
    proof: s.proof,
  };
}

/** EIP-7702 delegations still vote with their EOA key through record(). */
export const contractOwner = (code: Hex): boolean =>
  code !== "0x" && !/^0xef0100[0-9a-f]{40}$/i.test(code);

/** ERC-1271 signatures can have arbitrary length and must reach the owner unchanged. */
export function recordCall(s: Parameters<typeof recordVote>[0], contract: boolean) {
  if (contract) {
    return {
      fn: "recordFor" as const,
      args: [s.tokenId, s.nonce, s.ballot, s.signature, s.proof] as const,
    };
  }
  return { fn: "record" as const, args: [[recordVote(s)]] as const };
}
