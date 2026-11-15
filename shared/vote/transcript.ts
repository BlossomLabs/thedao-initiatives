import { encodeAbiParameters, type Hex, keccak256, zeroAddress, zeroHash } from "viem";

/** One record the contract appended to its transcript, in chain order. */
export type TranscriptEvent =
  | { tokenId: string; voter: Hex; nonce: bigint; ballot: Hex }
  | { tokenId: string; revoked: true };

/** Contracts deployed before Nov 14 (commit 16ee6b4) hashed a sixth word, a zero
 * "blobHash", into every entry. */
const LEGACY_ENTRY = [
  { type: "bytes32" },
  { type: "uint256" },
  { type: "address" },
  { type: "uint64" },
  { type: "bytes32" },
  { type: "bytes32" },
] as const;

const ENTRY = [
  { type: "bytes32" },
  { type: "uint256" },
  { type: "address" },
  { type: "uint64" },
  { type: "bytes32" },
] as const;

/** Replays the contract's running hash over the events read: the transcript, the record
 * count, and each token's last ballot hash (zero after a revocation). Pure, so the replay
 * can prove the ballots it counts are the ones the contract committed to. A revocation
 * carries voter zero and the token's last recorded nonce (zero if it never voted). */
export function transcriptOf(
  events: TranscriptEvent[],
  /** Hash entries the way the pre-Nov 14 contracts did (a trailing zero word). */
  legacy = false,
): { transcript: Hex; count: number; lastHash: Map<string, Hex> } {
  let transcript: Hex = zeroHash;
  const lastHash = new Map<string, Hex>();
  const nonces = new Map<string, bigint>();
  for (const e of events) {
    let voter: Hex, nonce: bigint, hash: Hex;
    if ("revoked" in e) {
      voter = zeroAddress;
      nonce = nonces.get(e.tokenId) ?? 0n;
      hash = zeroHash;
    } else {
      voter = e.voter;
      nonce = e.nonce;
      hash = keccak256(e.ballot);
      nonces.set(e.tokenId, nonce);
    }
    const id = BigInt(e.tokenId);
    transcript = keccak256(
      legacy
        ? encodeAbiParameters(LEGACY_ENTRY, [transcript, id, voter, nonce, hash, zeroHash])
        : encodeAbiParameters(ENTRY, [transcript, id, voter, nonce, hash]),
    );
    lastHash.set(e.tokenId, hash);
  }
  return { transcript, count: events.length, lastHash };
}
