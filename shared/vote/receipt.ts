import { decodeEventLog, decodeFunctionData, type Hex } from "viem";
import { SIGNED_BALLOTS_ABI } from "./abi.ts";
import type { VoteManifest } from "./manifest.ts";

export type BallotTxResult = "recorded" | "reverted" | "mismatch";

/** A matching successful record is on-chain; only replay can decide whether it counts. */
export function checkBallotTx(input: {
  m: VoteManifest;
  tx?: { to: string | null; input: `0x${string}` };
  status: "success" | "reverted";
  logs?: readonly { address: string; data: Hex; topics: readonly Hex[] }[];
  blockTimestamp?: number;
  expect: { tokenId: bigint; nonce: bigint; ballot: `0x${string}` };
}): BallotTxResult {
  const { m, tx, expect } = input;
  if (input.logs) {
    if (input.status !== "success") return "reverted";
    const found = input.logs.some((log) => {
      if (log.address.toLowerCase() !== m.contract.toLowerCase()) return false;
      try {
        const event = decodeEventLog({
          abi: SIGNED_BALLOTS_ABI,
          data: log.data,
          topics: [...log.topics] as [Hex, ...Hex[]],
          eventName: "BallotRecorded",
        });
        return event.args.tokenId === expect.tokenId && event.args.nonce === expect.nonce &&
          event.args.ballot.toLowerCase() === expect.ballot.toLowerCase();
      } catch {
        return false;
      }
    });
    if (!found) return "mismatch";
    return "recorded";
  }
  if (!tx?.to || tx.to.toLowerCase() !== m.contract.toLowerCase()) return "mismatch";
  let call;
  try {
    call = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: tx.input });
  } catch {
    return "mismatch";
  }
  let tokenId: bigint, nonce: bigint, ballot: `0x${string}`;
  if (call.functionName === "recordFor" || call.functionName === "vote") {
    // vote(tokenId, nonce, ballot, proof); recordFor(tokenId, nonce, ballot, signature, proof).
    [tokenId, nonce, ballot] = call.args.slice(0, 3) as [bigint, bigint, `0x${string}`];
  } else if (call.functionName === "record") {
    // The relay sends one vote per record() call.
    const votes = call.args[0] as readonly {
      tokenId: bigint;
      nonce: bigint;
      ballot: `0x${string}`;
    }[];
    if (votes.length !== 1) return "mismatch";
    ({ tokenId, nonce, ballot } = votes[0]);
  } else return "mismatch";
  if (
    tokenId !== expect.tokenId || nonce !== expect.nonce ||
    ballot.toLowerCase() !== expect.ballot.toLowerCase()
  ) return "mismatch";
  if (input.status !== "success") return "reverted";
  return "recorded";
}

/** Match a particular submission, not an earlier accepted ballot with identical bytes. */
export function replayedBallot(
  view: {
    accepted: Record<string, string>;
    acceptedNonces?: Record<string, number>;
    rejected: { tokenId: string; nonce: number; reason: string }[];
  },
  expect: { tokenId: bigint; nonce: bigint; ballot: Hex },
): "counted" | "rejected" | "superseded" | null {
  const id = expect.tokenId.toString();
  const nonce = view.acceptedNonces?.[id];
  if (nonce !== undefined && BigInt(nonce) > expect.nonce) return "superseded";
  const accepted = view.accepted[id]?.toLowerCase();
  const ballot = expect.ballot.toLowerCase();
  // Short recorded ballots leave later initiatives unplaced; replay pads those bytes.
  if (
    nonce !== undefined && BigInt(nonce) === expect.nonce && accepted &&
    accepted.startsWith(ballot) && /^(ff)*$/.test(accepted.slice(ballot.length))
  ) return "counted";
  if (view.rejected.some((r) => r.tokenId === id && BigInt(r.nonce) === expect.nonce)) {
    return "rejected";
  }
  return null;
}
