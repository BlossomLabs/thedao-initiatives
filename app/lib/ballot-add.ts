/** Put on the ballot, in the round admin's browser: their wallet sends the round's
 * `addGroup` (new affiliations) and `addInitiative` transactions, one at a time (any
 * wallet, Privy's included). A new affiliation's id is read from its receipt, never
 * assumed: another admin's affiliation landing first can't misdirect the initiative
 * (#147). The page waits until
 * the site's round includes the initiative, then each open pledge is signed (relayed by
 * the API, as in Pledges to sign). Every wallet, chain and API call is injected so the
 * sequence can be tested on its own, like pledge-flow.ts. */
import type { Hex } from "viem";
import type { AddBlocker } from "../../shared/vote/add-plan";
import type { ReadyJson } from "./api-types";
import { dayTime } from "./format";

export type BallotCall = {
  fn: "addGroup" | "addInitiative";
  args: readonly unknown[];
  /** addGroup: the id the plan gave it (the round's count when planned, plus its place).
   * The initiative's mask uses it until the receipt says which id it really got. */
  group?: number;
};

export interface BallotAddDeps {
  /** Claims the initiative for this admin's run, first of all: "ok", or who holds it (as
   * the page names them). One round admin at a time puts an initiative on the ballot. Called
   * again before each send and each signature, to renew it (a run outlasting the claim's
   * five minutes keeps it). */
  claim(): Promise<"ok" | { by: string }>;
  /** Lets the claim go once the run has ended, whatever the outcome. */
  release(): Promise<void>;
  /** The round's calls for this initiative: `addPlan(round, [card]).calls`, from the round
   * read afresh (so a retry never adds an affiliation twice); none when it is in already. */
  plan(): BallotCall[] | Promise<BallotCall[]>;
  /** Sent by the connected wallet; resolves with the transaction's hash. */
  send(call: BallotCall): Promise<Hex>;
  /** The mined receipt's status; rejects on timeout. A reverted `addInitiative` may reject
   * with the revert's reason instead (DuplicateInitiative: another admin added it first). */
  waitReceipt(hash: Hex, call: BallotCall): Promise<"success" | "reverted">;
  /** The id an `addGroup` transaction's GroupAdded event names; rejects when it can't. */
  addedGroup(hash: Hex): Promise<number>;
  /** Whether the site's round lists the initiative yet (one look). */
  inRound(): Promise<boolean>;
  /** Signs one of its pledges as it stands (Pledges to sign's flow). */
  signPledge(pid: string): Promise<"saved" | "failed">;
  sleep(ms: number): Promise<void>;
}

export type BallotPhase =
  /** Transaction `step` of `of`; `hash` once the wallet has sent it. */
  | { kind: "adding"; step: number; of: number; hash?: Hex }
  /** `already`: another admin's add landed first (DuplicateInitiative). */
  | { kind: "waiting-round"; already?: true }
  /** Pledge `done + 1` of `of` is being signed. */
  | { kind: "signing"; done: number; of: number }
  | { kind: "done" }
  /** `added`: it is in the round (its unsigned pledges wait in Pledges to sign). */
  | { kind: "failed"; reason: string; added: boolean };

/** The site's round is checked every 3 s, for up to 2 minutes. */
const ROUND_GAP_MS = 3_000;
const ROUND_TRIES = 40;

export const NOT_SEEN =
  "The add landed but the site hasn't seen it yet. Reload in a minute; the pledges will be in Pledges to sign.";
const DECLINED = "You didn't send it, so nothing was added.";
const REVERTED = "The transaction failed on-chain, so it wasn't added.";
const TOO_LONG = "It's taking too long to be mined. Reload in a minute to see whether it landed.";
const UNSIGNED = "It's on the ballot, but a pledge wasn't signed. It waits in Pledges to sign.";

const taken = (by: string) => `${by} is already putting it on the ballot.`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const declined = (e: unknown) => /reject|denied|cancel/i.test(message(e));

/** Did the contract refuse an add because the initiative is in the round already (another
 * admin added it first)? viem's decoded revert names it; its message says it too. */
export function isDuplicateInitiative(e: unknown): boolean {
  const walk = (e as { walk?: (fn: (x: unknown) => boolean) => unknown } | null)?.walk;
  if (
    typeof walk === "function" &&
    walk.call(
      e,
      (x) =>
        (x as { data?: { errorName?: string } } | null)?.data?.errorName === "DuplicateInitiative",
    )
  ) return true;
  return /DuplicateInitiative/.test(message(e));
}

/** Add `ready` to the round, then sign its open pledges. Each step goes to `onPhase`;
 * the outcome is returned too. The run first claims the initiative (another admin's claim
 * ends it before anything is sent) and lets the claim go once it has ended. */
export async function putOnBallot(
  d: BallotAddDeps,
  ready: ReadyJson,
  onPhase: (p: BallotPhase) => void,
): Promise<BallotPhase> {
  const end = (p: BallotPhase) => {
    onPhase(p);
    return p;
  };
  const fail = (reason: string, added: boolean) => end({ kind: "failed", reason, added });
  let claimed: Awaited<ReturnType<BallotAddDeps["claim"]>>;
  try {
    claimed = await d.claim();
  } catch (e) {
    return fail(message(e), false);
  }
  if (claimed !== "ok") return fail(taken(claimed.by), false);
  try {
    return await run(d, ready, onPhase, end, fail);
  } finally {
    await d.release().catch(() => {});
  }
}

async function run(
  d: BallotAddDeps,
  ready: ReadyJson,
  onPhase: (p: BallotPhase) => void,
  end: (p: BallotPhase) => BallotPhase,
  fail: (reason: string, added: boolean) => BallotPhase,
): Promise<BallotPhase> {
  let calls: BallotCall[];
  try {
    calls = await d.plan();
  } catch (e) {
    return fail(message(e), false);
  }
  // One at a time: an initiative's groups must exist before it is added.
  let landed = 0;
  /** A later call failed after affiliations landed: say so, the retry plans without them. */
  const failAdd = (reason: string) =>
    fail(
      landed === 0
        ? reason
        : `The ${
          landed === 1 ? "affiliation was" : "affiliations were"
        } added, but the initiative wasn't. Press Put on the ballot again.`,
      false,
    );
  /** Renews the claim; who took it over, if another admin did after it lapsed. A renewal
   * that can't be sent doesn't stop the run (the contract still refuses a duplicate add). */
  const lost = async (): Promise<string | null> => {
    const r = await d.claim().catch(() => "ok" as const);
    return r === "ok" ? null : r.by;
  };
  /** Another admin added it first: the contract refused ours as a duplicate. */
  let already = false;
  const duplicate = (call: BallotCall, e: unknown) =>
    call.fn === "addInitiative" && isDuplicateInitiative(e);
  /** Planned affiliation id → the id it got, where they differ. */
  const moved = new Map<number, number>();
  for (const [i, planned] of calls.entries()) {
    const call = remapGroups(planned, moved);
    const at = { kind: "adding" as const, step: i + 1, of: calls.length };
    onPhase(at);
    const by = await lost();
    if (by) return fail(taken(by), false);
    let hash: Hex;
    try {
      hash = await d.send(call);
    } catch (e) {
      if (duplicate(call, e)) {
        already = true;
        break;
      }
      return failAdd(declined(e) ? DECLINED : message(e));
    }
    onPhase({ ...at, hash });
    let status: "success" | "reverted";
    try {
      status = await d.waitReceipt(hash, call);
    } catch (e) {
      if (duplicate(call, e)) {
        already = true;
        break;
      }
      return failAdd(TOO_LONG);
    }
    if (status === "reverted") return failAdd(REVERTED);
    landed++;
    if (call.fn === "addGroup" && call.group !== undefined) {
      let id: number;
      try {
        id = await d.addedGroup(hash);
      } catch {
        // Landed, but its id is unknown: stop before the initiative could be misdirected.
        // The retry plans on the round as it is, and joins this affiliation by its name.
        return failAdd(TOO_LONG);
      }
      if (id !== call.group) moved.set(call.group, id);
    }
  }

  onPhase(already ? { kind: "waiting-round", already: true } : { kind: "waiting-round" });
  let seen = false;
  for (let i = 0; i < ROUND_TRIES && !seen; i++) {
    if (i) await d.sleep(ROUND_GAP_MS);
    seen = await d.inRound().catch(() => false);
  }
  if (!seen) return fail(NOT_SEEN, true);

  const of = ready.pledges.length;
  for (const [done, p] of ready.pledges.entries()) {
    onPhase({ kind: "signing", done, of });
    const by = await lost();
    if (by) return fail(taken(by), true);
    // The first refusal stops here: the rest wait in Pledges to sign.
    if (await d.signPledge(p.pid).catch(() => "failed" as const) !== "saved") {
      return fail(UNSIGNED, true);
    }
  }
  return end({ kind: "done" });
}

/** `call` with each planned affiliation id in its mask (an addInitiative's 4th argument)
 * replaced by the id the affiliation got. */
export function remapGroups(call: BallotCall, moved: ReadonlyMap<number, number>): BallotCall {
  if (call.fn !== "addInitiative" || !moved.size) return call;
  const mask = call.args[3] as bigint;
  let out = mask;
  for (const from of moved.keys()) {
    if ((mask >> BigInt(from)) & 1n) out &= ~(1n << BigInt(from));
  }
  for (const [from, to] of moved) {
    if ((mask >> BigInt(from)) & 1n) out |= 1n << BigInt(to);
  }
  return { ...call, args: [...call.args.slice(0, 3), out, ...call.args.slice(4)] };
}

/** Right after the add, the API may still read the round without the initiative (an
 * isolate's copy of the round, a few seconds old): a pledge's prepare answering 404 is
 * tried again every 2 s, for up to 10 s, before the run gives up. */
export const PREPARE_GAP_MS = 2_000;
export const PREPARE_WAIT_MS = 10_000;
export async function prepareInRound<T>(
  prepare: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  /** Is the error the API's 404 ("That initiative isn't in the round.")? */
  notInRound: (e: unknown) => boolean,
): Promise<T> {
  for (let waited = 0;; waited += PREPARE_GAP_MS) {
    try {
      return await prepare();
    } catch (e) {
      if (!notInRound(e) || waited >= PREPARE_WAIT_MS) throw e;
    }
    await sleep(PREPARE_GAP_MS);
  }
}

/** Why an initiative can't be put on the ballot now; null when it can (or is on it). */
export function blockerText(b: AddBlocker | null): string | null {
  if (!b) return null;
  switch (b.kind) {
    case "no-safe":
      return "Add a Safe first.";
    case "safe-used":
      return "Another initiative in the round uses this Safe.";
    case "rfp-affiliations":
      return "An RFP can't have affiliations.";
    case "closed":
      return b.opensAt === null ? "The vote is over." : `Opens again ${dayTime(b.opensAt)}.`;
    case "already":
      return null;
  }
}
