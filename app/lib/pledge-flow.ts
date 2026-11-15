/** An admin's pledge during the real vote, sent like a ballot: signed, relayed by the API
 * (answered with the hash right after the broadcast), then the browser waits for the
 * receipt itself and asks the API to settle it. Every API, wallet and chain call is
 * injected so the flow can be tested on its own. */
import type { Hex } from "viem";

/** `earlier`: the phase is about an earlier change to this pledge that was already on
 * its way (the API's 409), not the one just asked for, which was not sent. */
export type PledgePhase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "relaying" }
  | { kind: "waiting"; hash: Hex; earlier?: true }
  | { kind: "saved"; hash?: Hex; earlier?: true }
  /** Mined, but the API hasn't seen it yet: the site shows it shortly. */
  | { kind: "recorded"; hash: Hex; reason: string; earlier?: true }
  | { kind: "failed"; reason: string; hash?: Hex; earlier?: true };

/** A change already on its way for this pledge (the API's 409 `pledge_pending`). */
export type Busy = { pending: { hash: Hex | null; pid: string } };
/** The signed write's answer: saved with no transaction needed, or broadcast. */
export type Sent = { saved: true } | { hash: Hex | null; pid: string };
export type SettleState = "saved" | "pending" | "failed";

export interface PledgeFlowDeps<P extends { pid: string }> {
  /** The chain's name, for the words: "Ethereum", "Sepolia". */
  chain: string;
  /** The write as typed: "saved" (not on-chain), or "sign" (the API's 428). */
  plain(): Promise<"saved" | "sign">;
  /** The typed data to sign, under the pledge's id. */
  prepare(): Promise<P | Busy>;
  sign(p: P): Promise<Hex>;
  send(p: P, signature: Hex): Promise<Sent | Busy>;
  /** The mined receipt's status; rejects on timeout. */
  waitReceipt(hash: Hex): Promise<"success" | "reverted">;
  /** POST …/pledges/:pid/settle. */
  settle(pid: string, hash: Hex | null): Promise<SettleState>;
  sleep(ms: number): Promise<void>;
}

export const TOO_LONG = "It's taking too long to be mined.";
export const REVERTED = "The transaction failed on-chain.";
const NOT_RECORDED = "The pledge wasn't recorded on-chain, so nothing was saved.";
export const EARLIER_REVERTED =
  "An earlier change to this pledge failed on-chain, so it wasn't saved. Send yours again if it's still needed.";
export const EARLIER_TOO_LONG =
  "An earlier change to this pledge is still being mined; the table shows it once it lands.";
export const EARLIER_NO_HASH =
  "This pledge has another change on its way; the table shows it once it lands.";
/** After the receipt, the API's node may be a block or two behind the browser's. */
const SETTLE_TRIES = 5;
const SETTLE_GAP_MS = 3_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const declined = (e: unknown) => /reject|denied|cancel/i.test(message(e));
const isBusy = (v: unknown): v is Busy => typeof v === "object" && v !== null && "pending" in v;

/** Wait for a change already sent, then have the API settle it. */
async function follow<P extends { pid: string }>(
  d: PledgeFlowDeps<P>,
  hash: Hex | null,
  pid: string,
  set: (p: PledgePhase) => void,
): Promise<PledgePhase> {
  const withHash = hash ? { hash } : {};
  if (hash) {
    set({ kind: "waiting", hash });
    let status: "success" | "reverted";
    try {
      status = await d.waitReceipt(hash);
    } catch {
      // Still on its way: the table shows it "Recording on-chain…" until a page load
      // settles it.
      return { kind: "failed", reason: TOO_LONG, hash };
    }
    if (status === "reverted") {
      await d.settle(pid, hash).catch(() => {});
      return { kind: "failed", reason: REVERTED, hash };
    }
  }
  for (let i = 0; i < SETTLE_TRIES; i++) {
    if (i) await d.sleep(SETTLE_GAP_MS);
    const state = await d.settle(pid, hash).catch(() => "pending" as const);
    if (state === "saved") return { kind: "saved", ...withHash };
    if (state === "failed") {
      return { kind: "failed", reason: hash ? REVERTED : NOT_RECORDED, ...withHash };
    }
  }
  // Mined with success: it landed, the API's node is just behind (a page load applies it).
  if (hash) {
    return {
      kind: "recorded",
      hash,
      reason: `It was recorded on ${d.chain}; the site will show it shortly.`,
    };
  }
  return { kind: "failed", reason: TOO_LONG };
}

/** The same outcome, as an earlier change's: its own words, and marked `earlier`. */
function asEarlier(p: PledgePhase): PledgePhase {
  if (p.kind === "failed") {
    const reason = p.reason === TOO_LONG ? EARLIER_TOO_LONG : EARLIER_REVERTED;
    return { ...p, reason, earlier: true };
  }
  return p.kind === "saved" || p.kind === "recorded" || p.kind === "waiting"
    ? { ...p, earlier: true }
    : p;
}

/**
 * Send one pledge change and say how it ended (each step through `set` too). When an
 * earlier change to the pledge is still on its way, it waits for that one and stops
 * there, like the ballot: this change is not sent, and the outcome is the earlier one's.
 */
export async function sendPledge<P extends { pid: string }>(
  d: PledgeFlowDeps<P>,
  set: (p: PledgePhase) => void,
  /** Told the id the pledge is signed under (a new pledge gets one from the API). */
  onPid?: (pid: string) => void,
): Promise<PledgePhase> {
  const end = (p: PledgePhase) => {
    set(p);
    return p;
  };
  try {
    if ((await d.plain()) === "saved") return { kind: "saved" };
  } catch (e) {
    return end({ kind: "failed", reason: message(e) });
  }
  set({ kind: "signing" });
  let sent: Sent | Busy;
  try {
    const prep = await d.prepare();
    if (isBusy(prep)) sent = prep;
    else {
      onPid?.(prep.pid);
      let signature: Hex;
      try {
        signature = await d.sign(prep);
      } catch (e) {
        return end({
          kind: "failed",
          reason: declined(e) ? "You didn't sign, so nothing was sent." : message(e),
        });
      }
      set({ kind: "relaying" });
      sent = await d.send(prep, signature);
    }
  } catch (e) {
    return end({ kind: "failed", reason: message(e) });
  }
  if ("saved" in sent) return end({ kind: "saved" });
  if (!isBusy(sent)) return end(await follow(d, sent.hash, sent.pid, set));
  const { hash, pid } = sent.pending;
  // Its hash isn't stored yet (another request is sending it): nothing to wait on here.
  if (!hash) return end({ kind: "failed", reason: EARLIER_NO_HASH, earlier: true });
  return end(asEarlier(await follow(d, hash, pid, (p) => set(asEarlier(p)))));
}
