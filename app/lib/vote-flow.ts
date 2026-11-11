/** The ballot's send-and-check flow, with every chain, wallet and API call
 * injected so it can be tested on its own. */
import { type Hex, keccak256 } from "viem";
import type { VoteManifest } from "../../shared/vote/manifest";
import type { BallotTxResult } from "../../shared/vote/receipt";
import { voteTypedData } from "../../shared/vote/typed-data";

export type BallotPhase =
  | { kind: "idle"; note?: string }
  | { kind: "signing" }
  | { kind: "relaying" }
  | { kind: "waiting"; hash: Hex }
  | { kind: "counted"; hash: Hex }
  | { kind: "late"; hash: Hex }
  | { kind: "failed"; reason: string; hash?: Hex };

export type Expected = { tokenId: bigint; nonce: bigint; ballot: Hex };
export type Signed = Expected & { signature: Hex; hash?: Hex };

export interface FlowDeps {
  ensureChain(): Promise<void>;
  signVote(typed: ReturnType<typeof voteTypedData>): Promise<Hex>;
  /** POST /api/vote/ballot; a 409 "pending" resolves to the hash already on its way. */
  relay(body: Signed): Promise<Hex>;
  nonceOf(tokenId: bigint): Promise<bigint>;
  ballotHashOf(tokenId: bigint): Promise<Hex>;
  /** Waits for the receipt, then checkBallotTx. Rejects on timeout. */
  waitResult(hash: Hex, expect: Expected): Promise<BallotTxResult>;
  /** POST /api/vote/gas: a one-time top-up hash, or null when not needed. */
  requestGas(tokenId: bigint): Promise<Hex | null>;
  waitTx(hash: Hex): Promise<void>;
  /** recordFor from the voter's own wallet, with their signature. */
  sendOwn(signed: Signed): Promise<Hex>;
}

const RESULT_TEXT: Record<Exclude<BallotTxResult, "counted" | "late">, string> = {
  reverted: "The transaction failed on-chain.",
  mismatch: "The transaction on-chain isn't the ballot you signed.",
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const declined = (e: unknown) => /reject|denied|cancel/i.test(message(e));

async function sendAndCheck(
  d: FlowDeps,
  signed: Signed,
  set: (p: BallotPhase) => void,
): Promise<Signed> {
  set({ kind: "relaying" });
  let hash: Hex;
  try {
    const { tokenId, nonce, ballot, signature } = signed;
    hash = await d.relay({ tokenId, nonce, ballot, signature });
  } catch (e) {
    set({ kind: "failed", reason: message(e) });
    return signed;
  }
  const withHash = { ...signed, hash };
  await check(d, withHash, hash, set);
  return withHash;
}

/** Wait for a hash already sent (by the relay or by the voter) and judge it. */
export async function check(
  d: FlowDeps,
  expect: Expected,
  hash: Hex,
  set: (p: BallotPhase) => void,
): Promise<void> {
  set({ kind: "waiting", hash });
  let result: BallotTxResult;
  try {
    result = await d.waitResult(hash, {
      tokenId: expect.tokenId,
      nonce: expect.nonce,
      ballot: expect.ballot,
    });
  } catch {
    set({ kind: "failed", reason: "It's taking too long to be mined.", hash });
    return;
  }
  if (result === "counted") set({ kind: "counted", hash });
  else if (result === "late") set({ kind: "late", hash });
  else set({ kind: "failed", reason: RESULT_TEXT[result], hash });
}

async function signNext(
  d: FlowDeps,
  m: VoteManifest,
  tokenId: bigint,
  voter: Hex,
  ballot: Hex,
  set: (p: BallotPhase) => void,
): Promise<Signed | null> {
  set({ kind: "signing" });
  try {
    await d.ensureChain();
    const nonce = (await d.nonceOf(tokenId)) + 1n;
    const signature = await d.signVote(voteTypedData(m, tokenId, voter, nonce, ballot));
    return { tokenId, nonce, ballot, signature };
  } catch (e) {
    if (declined(e)) set({ kind: "idle", note: "You didn't sign, so nothing was sent." });
    else set({ kind: "failed", reason: message(e) });
    return null;
  }
}

export async function submitBallot(
  d: FlowDeps,
  m: VoteManifest,
  tokenId: bigint,
  voter: Hex,
  ballot: Hex,
  set: (p: BallotPhase) => void,
): Promise<Signed | null> {
  const signed = await signNext(d, m, tokenId, voter, ballot, set);
  return signed ? await sendAndCheck(d, signed, set) : null;
}

/** Retry: first ask the chain whether the earlier send landed after all. */
export async function retryBallot(
  d: FlowDeps,
  m: VoteManifest,
  voter: Hex,
  last: Signed,
  set: (p: BallotPhase) => void,
): Promise<Signed | null> {
  set({ kind: "relaying" });
  let onchain: bigint;
  try {
    onchain = await d.nonceOf(last.tokenId);
  } catch (e) {
    set({ kind: "failed", reason: message(e), hash: last.hash });
    return last;
  }
  if (onchain >= last.nonce) {
    const stored = await d.ballotHashOf(last.tokenId).catch(() => null);
    if (onchain === last.nonce && stored?.toLowerCase() === keccak256(last.ballot).toLowerCase()) {
      set({ kind: "counted", hash: last.hash ?? ("0x" as Hex) });
      return last;
    }
    // Another ballot took that nonce: sign this one again for the next.
    return await submitBallot(d, m, last.tokenId, voter, last.ballot, set);
  }
  return await sendAndCheck(d, last, set);
}

/** "Send it yourself": the same signed ballot, submitted from the voter's wallet. */
export async function selfSendBallot(
  d: FlowDeps,
  m: VoteManifest,
  tokenId: bigint,
  voter: Hex,
  ballot: Hex,
  last: Signed | null,
  set: (p: BallotPhase) => void,
): Promise<Signed | null> {
  let signed: Signed | null = null;
  if (last && last.tokenId === tokenId && last.ballot.toLowerCase() === ballot.toLowerCase()) {
    const onchain = await d.nonceOf(tokenId).catch(() => null);
    if (onchain !== null && onchain + 1n === last.nonce) {
      const { hash: _, ...rest } = last;
      signed = rest;
    }
  }
  signed ??= await signNext(d, m, tokenId, voter, ballot, set);
  if (!signed) return null;
  set({ kind: "relaying" });
  try {
    await d.ensureChain();
    const gas = await d.requestGas(tokenId).catch(() => null);
    if (gas) await d.waitTx(gas);
  } catch {
    // No top-up: the wallet may hold enough already, so let it try.
  }
  let hash: Hex;
  try {
    hash = await d.sendOwn(signed);
  } catch (e) {
    if (declined(e)) set({ kind: "idle", note: "You didn't confirm, so nothing was sent." });
    else set({ kind: "failed", reason: message(e) });
    return signed;
  }
  const withHash = { ...signed, hash };
  await check(d, withHash, hash, set);
  return withHash;
}
