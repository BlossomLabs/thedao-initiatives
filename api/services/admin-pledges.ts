import { roundKey } from "../../shared/vote/keys.ts";
/**
 * Admin pledges during the real vote. A pledge to an initiative in the round lowers the
 * ask the tally uses, so the chain is the truth: the admin signs an EIP-712 Pledge, the
 * vote's relayer sends setPledgeBySig, and the site's row follows what landed.
 *
 * Like a ballot, a change is answered with its hash right after the broadcast; the browser
 * waits for the receipt itself, then asks for the change to be settled. Every relayed
 * change is kept as a pending record (KV) from before it is sent until it settles: applied
 * once the chain holds it, discarded once it can no longer land. One the browser never
 * settled is settled the next time the initiative's pledges are read or written by an
 * admin. A pledge has at most one change in flight.
 */
import { type Hex, isHex, verifyTypedData } from "viem";
import type { Deps } from "../middleware/context.ts";
import type { Pledge, PledgeStatus } from "../db/types.ts";
import { HttpError } from "../lib/errors.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { pledgeChainId, pledgeTypedData } from "../../shared/vote/typed-data.ts";
import { errorText, sendNext, withRelayer } from "../routes/vote.ts";
import type { VoteRound } from "./vote-chain.ts";
import { currentVote } from "./vote-active.ts";

/** How long an admin's pledge signature stays good: short, so an unsent one can't
 * later restore an amount. */
export const PLEDGE_DEADLINE_SECS = 600;
/** Past its deadline a transaction can only revert; this long past it, a node behind has
 * caught up with one that landed in time. */
const DEADLINE_MARGIN_SECS = 60;
/** How long a claim to apply a landed change holds before another request takes it over. */
const APPLY_LEASE_SECS = 60;
/** How long a settled change's outcome is kept, for a browser that asks after the page
 * load settled it. */
const OUTCOME_MS = 7 * 24 * 3600_000;
export const PLEDGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UINT_RE = /^\d{1,20}$/;
export const SIGNED_FIELDS = ["pid", "nonce", "deadline", "signature"];
/** The contract's reverts for setPledgeBySig, in words for the admin. */
export const PLEDGE_REVERTS: [RegExp, string][] = [
  [/PledgeExpired/, "the signature expired"],
  [/InvalidPledgeNonce/, "the signature was already used, or another pledge of yours went first"],
  [/InvalidSignature/, "the contract didn't accept the signature"],
  [/AccessControlUnauthorizedAccount/, "your wallet can't record pledges for this round"],
  [/VotingClosed/, "the round has closed"],
];

/**
 * Null when the pledge is the site's alone: no real vote, the round is over (the
 * contract's `hardDeadline`, which the manifest's `closesAt` is), or the initiative isn't
 * in it. Otherwise its place in the round.
 */
export function pledgeOnChain(
  m: VoteManifest | null | undefined,
  slug: string,
  now: number,
): { initiativeId: number } | null {
  if (!m || m.kind !== "real" || now >= m.closesAt) return null;
  const i = m.slugs.indexOf(slug);
  return i < 0 ? null : { initiativeId: i };
}

/** What a pledge takes off the ask: an open pledge its amount, a received or withdrawn
 * one nothing (a received one counts as a donation instead). Micro-USD, currency 0. */
export const onChainAmount = (status: PledgeStatus, amountUsd: number): bigint =>
  status === "pledged" ? BigInt(Math.round(amountUsd * 1e6)) : 0n;

export type PledgeRow = Omit<Pledge, "id" | "rfpId" | "createdAt">;
export type PledgePatch = Partial<
  Pick<Pledge, "company" | "amountUsd" | "url" | "note" | "logoCid">
>;
/** What a request does to one pledge. */
export type PledgeChange =
  | { kind: "add"; row: PledgeRow }
  | { kind: "edit"; patch: PledgePatch; status?: PledgeStatus }
  | { kind: "remove" };

/** The amount a change leaves on-chain, given the pledge's row now. */
export function amountAfter(change: PledgeChange, cur: Pledge | null): bigint {
  if (change.kind === "remove") return 0n;
  if (change.kind === "add") return onChainAmount(change.row.status, change.row.amountUsd);
  if (!cur) throw new HttpError(404, "not found");
  return onChainAmount(change.status ?? cur.status, change.patch.amountUsd ?? cur.amountUsd);
}

export type SignedPledge = { pid: string; nonce: bigint; deadline: bigint; signature: Hex };

export const pledgeFail = (
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) => new HttpError(status, message, { code, ...extra });

/** The signature fields of a request; 428 when any is missing (the form then asks
 * the wallet to sign and sends again). */
export function signedPledgeOf(fields: Record<string, unknown>): SignedPledge {
  const { pid, nonce, deadline, signature } = fields;
  if ([pid, nonce, deadline, signature].some((v) => v === undefined || v === "")) {
    throw pledgeFail(
      428,
      "signature_required",
      "During the vote a pledge is recorded on-chain first: sign it with your wallet.",
    );
  }
  if (
    typeof pid !== "string" || !PLEDGE_ID_RE.test(pid) ||
    typeof nonce !== "string" || !UINT_RE.test(nonce) ||
    typeof deadline !== "string" || !UINT_RE.test(deadline) ||
    typeof signature !== "string" || !isHex(signature)
  ) throw pledgeFail(400, "bad_signature", "That pledge signature isn't valid.");
  return { pid, nonce: BigInt(nonce), deadline: BigInt(deadline), signature };
}

/** A relayed change not settled yet. Numbers as decimal strings. */
type PendingRecord = {
  rfpId: string;
  pid: string;
  /** The project's id on-chain. */
  initiativeId: number;
  change: PledgeChange;
  amount: string;
  admin: Hex;
  nonce: string;
  deadline: string;
  /** For the admin's table; null when the send's hash was never stored. */
  hash: Hex | null;
  at: number;
  /** Set when a request claimed the landed change to apply it. */
  applyingAt?: number;
};

/** How a settled change ended, kept a while after its record is gone. */
type Outcome = { hash: Hex | null; state: "landed" | "failed" };
/** Where a change stands, for the form that sent it. */
export type SettleState = "saved" | "pending" | "failed";

/** A change still on its way, for the admin's table. */
export type PendingPledgeJson = {
  pid: string;
  kind: PledgeChange["kind"];
  company: string | null;
  amountUsd: number | null;
  hash: Hex | null;
};

/** Under the round's own records (kept by backups with the rest of the vote). */
const pendingPrefix = (d: VoteRound, rfpId: string) => [
  ...roundKey(d.manifest),
  "pledge-pending",
  rfpId,
];
const pendingKey = (d: VoteRound, rfpId: string, pid: string) => [
  ...pendingPrefix(d, rfpId),
  pid,
];
const outcomeKey = (d: VoteRound, rfpId: string, pid: string) => [
  ...roundKey(d.manifest),
  "pledge-outcome",
  rfpId,
  pid,
];
/** The 409 for a pledge with a change on its way, with that change's hash (like the
 * ballot's), so the form can wait for it. */
const pendingFail = (rec: Pick<PendingRecord, "hash" | "pid">) =>
  pledgeFail(
    409,
    "pledge_pending",
    `This pledge's last change is still being recorded on-chain${
      rec.hash ? ` (transaction ${rec.hash})` : ""
    }. It shows here once it lands.`,
    { hash: rec.hash, pid: rec.pid },
  );
/** The same row, as far as the admin typed it (createdAt aside). */
const sameRow = (a: Pledge, b: PledgeRow) =>
  a.company === b.company && a.amountUsd === b.amountUsd && a.status === b.status &&
  a.note === b.note && a.url === b.url && a.logoCid === b.logoCid;

export function adminPledges(deps: Deps) {
  const { db } = deps;
  const kv = db.kv;

  /** The vote round and the pledge's place in it, when this initiative's pledges go on-chain. */
  const onChainFor = async (initiative: { slug: string }) => {
    const d = await currentVote(deps);
    const at = pledgeOnChain(d?.manifest, initiative.slug, deps.now());
    return d && at ? { d, at } : null;
  };

  /** Make a change to the site's row. Applying it twice gives the same row. */
  async function apply(rfpId: string, pid: string, change: PledgeChange) {
    // Applied again after a request died midway: an add already written stays as it is.
    if (change.kind === "add") {
      if (!await db.pledges.get(rfpId, pid)) await db.pledges.add(rfpId, change.row, pid);
    } else if (change.kind === "remove") await db.pledges.remove(rfpId, pid);
    else {
      if (Object.keys(change.patch).length) await db.pledges.update(rfpId, pid, change.patch);
      if (change.status !== undefined) await db.pledges.setStatus(rfpId, pid, change.status);
    }
  }

  /** Does the chain hold what this change leaves? Since a record is only claimed when it
   * didn't, and a pledge has one change in flight, holding it means the change landed. */
  async function holds(d: VoteRound, rec: PendingRecord, block?: bigint): Promise<boolean> {
    const p = await d.chain.pledgeOf(pledgeChainId(rec.pid), block);
    return p.exists && p.initiativeId === BigInt(rec.initiativeId) && p.currencyId === 0n &&
      p.amount === BigInt(rec.amount);
  }

  /**
   * Where a pending change stands, from the chain's state (not the transaction's: a node
   * that lost track of it says nothing about whether it landed). Failed only once it can
   * no longer land: its nonce is used, its deadline long past, or its receipt reverted, and
   * the chain doesn't hold it. A read error throws: the record stays, settled on a later
   * look.
   */
  async function fate(d: VoteRound, rec: PendingRecord): Promise<"landed" | "failed" | "pending"> {
    // Both at one block: if ours used the nonce, the pledge read there shows the change
    // (a load-balanced RPC could otherwise answer the two from different heads).
    const block = await d.chain.blockNumber();
    const [nonce, held] = await Promise.all([
      d.chain.pledgeNonceOf(rec.admin, block),
      holds(d, rec, block),
    ]);
    if (held) return "landed";
    const nonceUsed = nonce > BigInt(rec.nonce);
    const expired = deps.now() > Number(rec.deadline) + DEADLINE_MARGIN_SECS;
    if (nonceUsed || expired) return "failed";
    // A revert leaves the nonce unused, so the state alone can't tell it from a change
    // still on its way: its receipt can (only a mined receipt says "reverted"; a node
    // that lost the transaction says "unknown", which proves nothing).
    if (rec.hash && (await d.chain.txStatus(rec.hash)) === "reverted") {
      // A reorg can turn a revert into a landing: one more look at the state.
      return (await holds(d, rec)) ? "landed" : "failed";
    }
    return "pending";
  }
  /** `fate`, with a read error as "not known yet". */
  const fateOrPending = (d: VoteRound, rec: PendingRecord) =>
    applyingFresh(rec) ? Promise.resolve("pending" as const) : fate(d, rec).catch((e) => {
      deps.log(`admin pledge: settling ${rec.pid} (${errorText(e)})`);
      return "pending" as const;
    });

  /** Another request is applying this record (claimed less than this long ago); after it, a
   * claimer that died is taken over and the change applied again. */
  const applyingFresh = (rec: PendingRecord) =>
    rec.applyingAt !== undefined && deps.now() - rec.applyingAt < APPLY_LEASE_SECS;

  /**
   * Settle a record that has an answer: a failed one is dropped; a landed one is claimed
   * (marked as applying, so only the winner goes on), applied, and only then deleted. A
   * request that dies midway leaves the record, and a later look applies it again: the
   * change is idempotent and the chain still holds it. True once the record is gone.
   */
  async function finish(
    d: VoteRound,
    entry: Deno.KvEntry<PendingRecord>,
    f: "landed" | "failed",
  ): Promise<boolean> {
    const rec = entry.value;
    const outcome: Outcome = { hash: rec.hash, state: f };
    const oKey = outcomeKey(d, rec.rfpId, rec.pid);
    if (f === "failed") {
      await kv.atomic().check(entry).delete(entry.key)
        .set(oKey, outcome, { expireIn: OUTCOME_MS }).commit();
      return true;
    }
    const claimed = { ...rec, applyingAt: deps.now() };
    const claim = await kv.atomic().check(entry).set(entry.key, claimed).commit();
    if (!claim.ok) return false;
    try {
      await apply(rec.rfpId, rec.pid, rec.change);
    } catch (e) {
      // The claim stays: once it lapses, a later look applies the change again.
      deps.log(`admin pledge: applying ${rec.pid} failed (${errorText(e)})`);
      return false;
    }
    await kv.atomic().check({ key: entry.key, versionstamp: claim.versionstamp })
      .delete(entry.key).set(oKey, outcome, { expireIn: OUTCOME_MS }).commit();
    return true;
  }

  /**
   * Settle the pledge's change in flight, if any, before another one: one look, then 409
   * `pledge_pending` with its hash if it hasn't settled (no second transaction goes out
   * meanwhile; the form waits for that one).
   */
  async function settle(d: VoteRound, rfpId: string, pid: string) {
    const entry = await kv.get<PendingRecord>(pendingKey(d, rfpId, pid));
    if (!entry.value) return;
    const f = await fateOrPending(d, entry.value);
    if (f !== "pending" && await finish(d, entry as Deno.KvEntry<PendingRecord>, f)) return;
    throw pendingFail(entry.value);
  }

  /**
   * The form's look after its own wait for the receipt of `hash`: settles that change if
   * it can, and says where it stands. A change already settled (by the page load, or
   * another tab) answers from its kept outcome; past that, from the transaction's status.
   */
  async function settleSent(
    rfpId: string,
    pid: string,
    hash: Hex | null,
  ): Promise<{ state: SettleState; pledge: Pledge | null }> {
    const d = await currentVote(deps);
    if (!d) throw new HttpError(404, "not found");
    const row = async (state: SettleState) => ({
      state,
      pledge: state === "saved" ? await db.pledges.get(rfpId, pid) : null,
    });
    const same = (h: Hex | null) => (h?.toLowerCase() ?? null) === (hash?.toLowerCase() ?? null);
    const entry = await kv.get<PendingRecord>(pendingKey(d, rfpId, pid));
    if (entry.value && same(entry.value.hash)) {
      const f = await fateOrPending(d, entry.value);
      if (f === "pending") return await row("pending");
      if (!await finish(d, entry as Deno.KvEntry<PendingRecord>, f)) return await row("pending");
      return await row(f === "landed" ? "saved" : "failed");
    }
    const outcome = (await kv.get<Outcome>(outcomeKey(d, rfpId, pid))).value;
    if (outcome && same(outcome.hash)) {
      return await row(outcome.state === "landed" ? "saved" : "failed");
    }
    // No record or kept outcome for this hash (settled long ago, or another change since):
    // what this answers is the transaction's status, not the row, which a later change may
    // have rewritten, so no row comes with it. Without a hash there is nothing to read: a
    // send whose hash was never stored is "pending" until its record or outcome says.
    if (!hash) return { state: "pending", pledge: null };
    const status = await d.chain.txStatus(hash).catch(() => "unknown" as const);
    return {
      state: status === "success" ? "saved" : status === "reverted" ? "failed" : "pending",
      pledge: null,
    };
  }

  /** One look at each of the initiative's changes in flight: the settled ones are applied or
   * dropped, the rest listed. For the admin page. */
  async function settleAll(rfpId: string): Promise<PendingPledgeJson[]> {
    const d = await currentVote(deps);
    const out: PendingPledgeJson[] = [];
    if (!d) return out;
    for await (const entry of kv.list<PendingRecord>({ prefix: pendingPrefix(d, rfpId) })) {
      const rec = entry.value;
      const f = await fateOrPending(d, rec);
      if (f !== "pending" && await finish(d, entry, f)) continue;
      out.push({
        pid: rec.pid,
        kind: rec.change.kind,
        company: rec.change.kind === "add" ? rec.change.row.company : null,
        amountUsd: rec.change.kind === "add" ? rec.change.row.amountUsd : null,
        hash: rec.hash,
      });
    }
    return out;
  }

  /** The pid of another initiative's pledge, on the site or on-chain, can't be reused here:
   * setPledgeBySig would move that pledge to this initiative. */
  async function assertPidFree(
    d: VoteRound,
    rfpId: string,
    initiativeId: number,
    pid: string,
  ) {
    const taken = () =>
      pledgeFail(409, "pledge_id_taken", "That pledge id belongs to another initiative.");
    const owner = await db.pledges.initiativeOf(pid);
    if (owner && owner !== rfpId) throw taken();
    for await (
      const e of kv.list<PendingRecord>({
        prefix: [...roundKey(d.manifest), "pledge-pending"],
      })
    ) {
      if (e.value.pid === pid && e.value.rfpId !== rfpId) throw taken();
    }
    const p = await d.chain.pledgeOf(pledgeChainId(pid));
    if (p.exists && p.initiativeId !== BigInt(initiativeId)) throw taken();
  }

  /**
   * Put a change on-chain with the admin's signature, then save it. The typed data is
   * rebuilt here from the change and the row as it stands, so a signature over anything
   * else is refused. When the chain already holds the amount the change leaves (a resend
   * of one that landed), it is saved with no new transaction.
   *
   * Answers the saved row (null after a removal) when no transaction was needed, or
   * `pending` with the hash right after the broadcast (null when the send's outcome is
   * unclear): the change is applied once the chain holds it. Throws, saving nothing, when
   * the send is refused before anything went out.
   */
  async function write(
    args: {
      d: VoteRound;
      initiativeId: number;
      rfpId: string;
      admin: Hex;
      signed: SignedPledge;
      change: PledgeChange;
    },
  ): Promise<
    { pending: false; pledge: Pledge | null } | { pending: true; hash: Hex | null; pid: string }
  > {
    const { d, initiativeId, rfpId, admin, signed, change } = args;
    const pid = signed.pid;
    const now = deps.now();
    if (signed.deadline <= BigInt(now)) {
      throw pledgeFail(400, "bad_deadline", "That signature has expired: send the pledge again.");
    }
    if (signed.deadline > BigInt(now + PLEDGE_DEADLINE_SECS)) {
      throw pledgeFail(400, "bad_deadline", "A pledge signature must expire within 10 minutes.");
    }
    await settle(d, rfpId, pid);
    const cur = await db.pledges.get(rfpId, pid);
    if (change.kind !== "add" && !cur) throw new HttpError(404, "not found");
    const amount = amountAfter(change, cur);
    const typed = pledgeTypedData(d.manifest, {
      pledgeId: pledgeChainId(pid),
      initiativeId: BigInt(initiativeId),
      currencyId: 0n,
      amount,
      nonce: signed.nonce,
      deadline: signed.deadline,
    });
    const valid = await verifyTypedData({
      address: admin,
      ...typed,
      signature: signed.signature,
    }).catch(() => false);
    // A smart wallet's signature can't be recovered here: the contract checks it
    // against this admin's address (ERC-1271), and refuses anything else.
    if (!valid && (await d.chain.codeOf(admin).catch(() => "0x")) === "0x") {
      throw pledgeFail(
        401,
        "bad_signature",
        "The signature isn't your wallet's for this pledge: send it again.",
      );
    }
    await assertPidFree(d, rfpId, initiativeId, pid);
    const saved = async () => ({
      pending: false as const,
      pledge: await db.pledges.get(rfpId, pid),
    });
    const onChain = await d.chain.pledgeOf(typed.message.pledgeId);
    const held = onChain.exists && onChain.initiativeId === BigInt(initiativeId) &&
      onChain.currencyId === 0n && onChain.amount === amount;
    if (change.kind === "add" && cur) {
      // A resend of an add that is already saved (it landed): the saved row stands.
      if (held && sameRow(cur, change.row)) return await saved();
      throw pledgeFail(409, "pledge_exists", "This pledge is already saved.");
    }
    if (held) {
      await apply(rfpId, pid, change);
      return await saved();
    }

    const key = pendingKey(d, rfpId, pid);
    const rec: PendingRecord = {
      rfpId,
      pid,
      initiativeId,
      change,
      amount: amount.toString(),
      admin,
      nonce: signed.nonce.toString(),
      deadline: signed.deadline.toString(),
      hash: null,
      at: now,
    };
    // Kept from before the send: one change in flight per pledge.
    const claimed = await kv.atomic().check({ key, versionstamp: null }).set(key, rec).commit();
    if (!claimed.ok) {
      // Another request claimed it just now: its hash, when it is stored yet.
      const other = (await kv.get<PendingRecord>(key)).value;
      throw pendingFail({ pid, hash: other?.hash ?? null });
    }
    const notRecorded = (why: string) =>
      pledgeFail(
        502,
        "pledge_not_recorded",
        `The pledge wasn't recorded on-chain, so nothing was saved: ${why}.`,
      );
    const m = typed.message;
    let hash: Hex;
    try {
      hash = await withRelayer(kv, d, async () => {
        const h = await sendNext(kv, d, now, {
          fn: "setPledgeBySig",
          args: [
            m.pledgeId,
            m.initiativeId,
            m.currencyId,
            m.amount,
            admin,
            m.nonce,
            m.deadline,
            signed.signature,
          ],
        });
        await kv.set(key, { ...rec, hash: h });
        return h;
      });
    } catch (e) {
      // Refused before anything went out: the relayer was busy, or the node's gas
      // estimate hit one of the contract's reverts. Nothing can land.
      const revert = PLEDGE_REVERTS.find(([re]) => re.test(String(e)));
      if (e instanceof HttpError || revert) {
        await kv.delete(key);
        if (e instanceof HttpError) throw e;
        deps.log(`admin pledge: setPledgeBySig refused (${errorText(e)})`);
        throw notRecorded(revert![1]);
      }
      // Anything else may have come after the broadcast: the record stays, and the chain
      // says later whether it landed.
      deps.log(`admin pledge: setPledgeBySig send unclear (${errorText(e)})`);
      return { pending: true, hash: null, pid };
    }
    return { pending: true, hash, pid };
  }

  /** Settle a change left in flight from the vote (the round may have closed since), before
   * a write that doesn't go on-chain. */
  async function settleLeftover(rfpId: string, pid: string) {
    const d = await currentVote(deps);
    if (d) await settle(d, rfpId, pid);
  }

  return { onChainFor, settle, settleAll, settleLeftover, settleSent, write };
}
