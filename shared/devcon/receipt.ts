import { decodeFunctionData } from "viem";
import { SIGNED_BALLOTS_ABI } from "./abi.ts";
import type { DevconManifest } from "./manifest.ts";

export type BallotTxResult = "counted" | "reverted" | "late" | "mismatch";

/** Is this mined transaction exactly the ballot the voter signed, counted in time? */
export function checkBallotTx(input: {
  m: DevconManifest;
  tx: { to: string | null; input: `0x${string}` };
  status: "success" | "reverted";
  blockTimestamp: number;
  expect: { tokenId: bigint; nonce: bigint; ballot: `0x${string}` };
}): BallotTxResult {
  const { m, tx, expect } = input;
  if (!tx.to || tx.to.toLowerCase() !== m.contract.toLowerCase()) return "mismatch";
  let call;
  try {
    call = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: tx.input });
  } catch {
    return "mismatch";
  }
  let tokenId: bigint, nonce: bigint, ballot: `0x${string}`;
  if (call.functionName === "recordFor" || call.functionName === "vote") {
    [tokenId, nonce, ballot] = call.args as readonly [bigint, bigint, `0x${string}`];
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
  if (input.blockTimestamp >= m.closesAt) return "late";
  return "counted";
}
