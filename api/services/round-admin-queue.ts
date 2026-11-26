/**
 * Waiting for a round admin: what only a wallet with the round's ADMIN_ROLE and PLEDGE_ROLE
 * can do, in one list for the admin pages.
 *
 * - **Ready for the ballot**: approved initiatives Qualified for the vote (the saved vote
 *   settings, as the board reads them) that aren't in the round, each with what would stop
 *   it from being added now (`addBlocker`). None once the deadline to qualify has passed
 *   (the real round only: a test round rehearses whenever).
 * - **Pledges to sign**, for the initiatives in the round: every awaiting request
 *   (./pledge-requests.ts; the real round only), every pledge with a change in flight (once,
 *   marked so), and every open pledge row whose on-chain record is missing or has another
 *   amount ("record": signed as it stands, the row left as it is).
 *
 * On a test round the list is the rehearsal's: a "record" there is signed as a test pledge
 * and never touches the site's rows. Once the round closes, nothing is listed.
 */
import type { Hex } from "viem";
import type { Deps } from "../middleware/context.ts";
import type { Initiative, Pledge, PledgeStatus } from "../db/types.ts";
import { HttpError } from "../lib/errors.ts";
import { ballotClosed, voteState } from "../../shared/vote.ts";
import {
  type AddBlocker,
  addBlocker,
  addingOpen,
  nextAddingOpen,
} from "../../shared/vote/add-plan.ts";
import { pledgeChainId } from "../../shared/vote/typed-data.ts";
import { roundKey } from "../../shared/vote/keys.ts";
import { voteSettings } from "../routes/board.ts";
import type { VoteRound } from "./vote-chain.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { adminBatch } from "../../shared/vote/admin-batch.ts";
import { dropGoalRequest, goalRequests } from "./goal-requests.ts";
import type { Tier } from "../../shared/vote/ballot.ts";
import type { Schedule } from "../../shared/vote/quiet-ending.ts";
import {
  adminPledges,
  onChainAmount,
  PLEDGE_ID_RE,
  type PledgeChange,
  pledgeFail,
} from "./admin-pledges.ts";
import {
  awaitingPledgesJson,
  effectiveChange,
  type PledgeRequest,
  pledgeRequests,
  requestKey,
} from "./pledge-requests.ts";

export type ReadyJson = {
  id: string;
  slug: string;
  title: string;
  goalUsd: number;
  raisedUsd: number;
  safeAddress: string;
  type: "rfp" | "grant";
  affiliations: string[];
  /** Its open pledges, signed once it is on the ballot. */
  pledges: { pid: string; company: string; amountUsd: number }[];
  blocker: AddBlocker | null;
  /** The round admin putting it on the ballot right now (unix seconds), if any. */
  claim: BallotClaim | null;
};
/** Who is putting an initiative on the ballot, since when (unix seconds). */
export type BallotClaim = { by: string; at: number };
/** A claim lapses on its own: a closed tab never blocks the others for long. */
export const BALLOT_CLAIM_MS = 5 * 60_000;
export type ToSignJson = {
  rfpId: string;
  slug: string;
  title: string;
  pid: string;
  company: string;
  kind: "add" | "edit" | "remove" | "record";
  /** What the pledge counts on-chain after the change (0 for a remove, a received or a
   * withdrawn pledge). */
  amountUsd: number;
  /** What it counts on-chain now, per its row (an add: null); for a "record", the chain's
   * (null: none there). */
  fromUsd: number | null;
  /** The pledge's status after the change (null for a remove). */
  status: PledgeStatus | null;
  /** Who asked, and when (unix seconds): an awaiting request's; null otherwise. */
  by: string | null;
  at: number | null;
  /** Why the request's last signed send failed, and when (unix seconds); null otherwise. */
  lastError: string | null;
  lastErrorAt: number | null;
  /** A change already relayed and not settled yet. */
  inFlight: { hash: Hex | null } | null;
};
/** A ballot initiative's goal change waiting for a round admin (#149). */
export type GoalToSignJson = {
  rfpId: string;
  slug: string;
  title: string;
  /** The goal the round has now, and the one asked for (dollars). */
  fromUsd: number;
  toUsd: number;
  by: string;
  at: number;
  /** `setInitiative`'s arguments, numbers as decimal strings. */
  call: { id: string; account: string; goalUsd: string; rfp: boolean; groups: string };
  /** The same call for an admin Safe (Transaction Builder JSON). */
  batch: ReturnType<typeof adminBatch>;
  /** The round's configuration revision the call was built at: a wallet send checks it. */
  configRevision: string | null;
  /** Why it can't be signed now; null when it can. */
  blocked: GoalBlock | null;
};
export type GoalBlock =
  | { kind: "settled"; tier: Tier }
  | { kind: "withdrawn" }
  | { kind: "settling"; until: number | null };

/** Why a goal change can't be signed now: the initiative settled (its award is final) or
 * was withdrawn, or a tier is settling (the round takes no changes until `until`). */
export function goalBlock(
  slug: string,
  initiatives: { slug: string; withdrawn: boolean; settledIn: Tier | null }[],
  s: Schedule,
  now: number,
): GoalBlock | null {
  const x = initiatives.find((y) => y.slug === slug);
  if (x?.settledIn) return { kind: "settled", tier: x.settledIn };
  if (x?.withdrawn) return { kind: "withdrawn" };
  if (!addingOpen(s, now)) return { kind: "settling", until: nextAddingOpen(s, now) };
  return null;
}
export type RoundAdminQueueJson = {
  kind: "real" | "test";
  ready: ReadyJson[];
  toSign: ToSignJson[];
  goals: GoalToSignJson[];
};

/** "Record it as it stands": the row's amount put on-chain, the row left as it is. */
export const RECORD: PledgeChange = { kind: "edit", patch: {} };
const isRecord = (c: PledgeChange) =>
  c.kind === "edit" && Object.keys(c.patch).length === 0 && c.status === undefined;

/** What a pledge counts on-chain, in USD. */
const usdOf = (status: PledgeStatus, amountUsd: number) =>
  Number(onChainAmount(status, amountUsd)) / 1e6;

const closedFail = () => new HttpError(410, "Voting has closed.");
const BALLOT_CLOSED = "No more initiatives can be added to the ballot.";
const ballotClosedFail = () =>
  new HttpError(409, BALLOT_CLOSED, { code: "ballot_closed", message: BALLOT_CLOSED });
/** Past the deadline to qualify, the real round takes no more initiatives; a test round (a
 * rehearsal) ignores it. */
const pastDeadline = async (deps: Deps, d: VoteRound) =>
  d.manifest.kind === "real" && ballotClosed(await voteSettings(deps), deps.now());

/** The claim on putting `rfpId` on the ballot of round `d`. */
export const ballotClaimKey = (d: VoteRound, rfpId: string) =>
  [...roundKey(d.manifest), "ballot-claim", rfpId] as const;
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** A claim still holding at `now` (unix seconds). KV deletes an expired key only "no
 * earlier than" its expireIn, so one older than five minutes may still be read: it counts
 * as gone. */
export const liveClaim = (c: BallotClaim | null, now: number): BallotClaim | null =>
  c && now < c.at + BALLOT_CLAIM_MS / 1000 ? c : null;

export function roundAdminQueue(deps: Deps) {
  const { db } = deps;
  const pledges = adminPledges(deps);
  const requests = pledgeRequests(deps);

  /** Approved, Qualified for the vote, not in the round; none past the deadline to qualify
   * (the real round). */
  async function ready(d: VoteRound): Promise<ReadyJson[]> {
    const m = d.manifest;
    const [cards, settings] = await Promise.all([
      db.initiatives.cards("approved"),
      voteSettings(deps),
    ]);
    if (m.kind === "real" && ballotClosed(settings, deps.now())) return [];
    const outside = cards.filter((c) => !m.slugs.includes(c.slug));
    const [summaries, claims] = await Promise.all([
      db.cards.summaries(outside.map((c) => c.id)),
      // Lapsed claims are gone on their own (expireIn).
      Promise.all(outside.map((c) => db.kv.get<BallotClaim>(ballotClaimKey(d, c.id)))),
    ]);
    const now = deps.now();
    const out = await Promise.all(outside.map(async (c, i): Promise<ReadyJson | null> => {
      const s = summaries[i];
      const sumOf = (status: Pledge["status"]) =>
        s.pledges.filter((p) => p.status === status).reduce((n, p) => n + p.amountUsd, 0);
      // The board's raised total (db/cards.ts summary, funding.summaryOf).
      const { total } = await deps.funding.summaryOf(c, {
        pledged: sumOf("pledged"),
        received: sumOf("received"),
        ledger: s.donatedUsd,
      });
      if (voteState(total, c.goalUsd, settings).kind !== "eligible") return null;
      const card = {
        slug: c.slug,
        goalUsd: c.goalUsd,
        safeAddress: c.safeAddress,
        type: c.type,
        raisedUsd: total,
        affiliations: c.affiliations ?? [],
      };
      return {
        id: c.id,
        title: c.title,
        ...card,
        pledges: s.pledges.filter((p) => p.status === "pledged")
          .map((p) => ({ pid: p.id, company: p.company, amountUsd: p.amountUsd })),
        blocker: addBlocker(m, card, now),
        claim: liveClaim(claims[i].value, now),
      };
    }));
    return out.filter((x) => x !== null);
  }

  /** The pledges of the round's initiatives that wait for a round admin's signature. */
  async function toSign(d: VoteRound): Promise<ToSignJson[]> {
    const m = d.manifest;
    const real = m.kind === "real";
    const [initiatives, reqs] = await Promise.all([
      Promise.all(m.slugs.map((slug) => db.initiatives.bySlug(slug))),
      real ? requests.list(d) : Promise.resolve([] as PledgeRequest[]),
    ]);
    const out: ToSignJson[] = [];
    /** Open rows nothing is asked or in flight for: listed when the chain differs. */
    const candidates: { base: Omit<ToSignJson, "fromUsd">; initiativeId: number }[] = [];
    // Each initiative's rows and changes in flight, all at once.
    const loaded = await Promise.all(initiatives.map((initiative) =>
      initiative &&
      Promise.all([
        db.pledges.list(initiative.id, true),
        // A test round has no relayed changes of the site's own (test pledges aren't kept).
        real ? pledges.inFlight(d, initiative.id) : Promise.resolve([]),
      ])
    ));
    for (const [initiativeId, initiative] of initiatives.entries()) {
      const got = loaded[initiativeId];
      if (!initiative || !got) continue;
      const rfpId = initiative.id;
      const [rows, flying] = got;
      const rowOf = (pid: string) => rows.find((p) => p.id === pid) ?? null;
      const of = { rfpId, slug: initiative.slug, title: initiative.title };
      const hashOf = new Map(flying.map((f) => [f.pid, f.hash]));
      const flight = (pid: string) => hashOf.has(pid) ? { hash: hashOf.get(pid)! } : null;
      const asked = new Set<string>();
      for (const req of reqs.filter((r) => r.rfpId === rfpId)) {
        // An edit or remove of a row that is gone (a signed remove landed) has nothing
        // left to sign.
        if (req.change.kind !== "add" && !rowOf(req.pid)) continue;
        asked.add(req.pid);
        const change = effectiveChange(req.change, rowOf(req.pid));
        const [a] = awaitingPledgesJson([{ ...req, change }], rows);
        out.push({
          ...of,
          pid: req.pid,
          company: a.company,
          kind: a.kind,
          amountUsd: a.amountUsd ?? 0,
          fromUsd: a.fromUsd,
          status: a.status,
          by: req.by,
          at: req.at,
          lastError: a.lastError,
          lastErrorAt: a.lastErrorAt,
          inFlight: flight(req.pid),
        });
      }
      for (const f of flying) {
        if (asked.has(f.pid)) continue;
        const row = rowOf(f.pid);
        const c = f.change;
        const status = c.kind === "add"
          ? c.row.status
          : c.kind === "remove"
          ? null
          : c.status ?? row?.status ?? "pledged";
        const amount = c.kind === "add"
          ? c.row.amountUsd
          : c.kind === "remove"
          ? 0
          : c.patch.amountUsd ?? row?.amountUsd ?? 0;
        out.push({
          ...of,
          pid: f.pid,
          company: c.kind === "add" ? c.row.company : row?.company ?? "",
          kind: isRecord(c) ? "record" : c.kind,
          amountUsd: status ? usdOf(status, amount) : 0,
          fromUsd: c.kind === "add" || !row ? null : usdOf(row.status, row.amountUsd),
          status,
          by: null,
          at: null,
          lastError: null,
          lastErrorAt: null,
          inFlight: { hash: f.hash },
        });
      }
      for (const row of rows) {
        if (row.status !== "pledged" || asked.has(row.id) || hashOf.has(row.id)) continue;
        candidates.push({
          initiativeId,
          base: {
            ...of,
            pid: row.id,
            company: row.company,
            kind: "record",
            amountUsd: row.amountUsd,
            status: row.status,
            by: null,
            at: null,
            lastError: null,
            lastErrorAt: null,
            inFlight: null,
          },
        });
      }
    }
    if (candidates.length) {
      // Every record read at one block, so the list is one state of the chain.
      const block = await d.chain.blockNumber();
      const onChain = await Promise.all(
        candidates.map((x) => d.chain.pledgeOf(pledgeChainId(x.base.pid), block)),
      );
      candidates.forEach(({ base, initiativeId }, i) => {
        const p = onChain[i];
        const ours = p.exists && p.initiativeId === BigInt(initiativeId) && p.currencyId === 0n;
        if (ours && p.amount === onChainAmount("pledged", base.amountUsd)) return;
        out.push({ ...base, fromUsd: ours ? Number(p.amount) / 1e6 : null });
      });
    }
    return out;
  }

  /** The whole list; empty once the round has closed. */
  async function queue(d: VoteRound): Promise<RoundAdminQueueJson> {
    const kind = d.manifest.kind;
    if (deps.now() >= d.manifest.closesAt) return { kind, ready: [], toSign: [], goals: [] };
    const [r, t, g] = await Promise.all([ready(d), toSign(d), goalsToSign(d.manifest)]);
    return { kind, ready: r, toSign: t, goals: g };
  }

  /** Goal requests of the real round (#149), each with the `setInitiative` call that
   * sets it: the round's account, RFP flag and groups kept as they are. */
  async function goalsToSign(m: VoteManifest): Promise<GoalToSignJson[]> {
    if (m.kind !== "real") return [];
    const out: GoalToSignJson[] = [];
    for (const r of await goalRequests(db, m)) {
      const row = await db.initiatives.get(r.rfpId);
      const i = row ? m.slugs.indexOf(row.slug) : -1;
      const account = m.accounts?.[i];
      if (!row || i < 0 || !account) continue;
      const p = m.projects[i];
      const goal = BigInt(Math.round(r.goalUsd * 100)) * 10_000n;
      // The round has it already (signed, or set another way): settled, not listed.
      if (BigInt(p.goalUsd) === goal) {
        await dropGoalRequest(db, r.rfpId);
        continue;
      }
      const groups = p.groups.reduce((a, g) => a | (1n << BigInt(g)), 0n);
      const args = [BigInt(i), account, goal, p.rfp, groups] as const;
      out.push({
        rfpId: r.rfpId,
        slug: row.slug,
        title: row.title,
        fromUsd: Number(BigInt(p.goalUsd) / 10_000n) / 100,
        toUsd: r.goalUsd,
        by: r.by,
        at: r.at,
        call: {
          id: String(i),
          account,
          goalUsd: goal.toString(),
          rfp: p.rfp,
          groups: groups.toString(),
        },
        configRevision: m.configRevision ?? null,
        blocked: null,
        batch: adminBatch(m, `Set ${row.slug}'s goal`, [
          ...(m.configRevision === undefined
            ? []
            : [{ fn: "requireConfigRevision", args: [BigInt(m.configRevision)] }]),
          { fn: "setInitiative", args },
        ]),
      });
    }
    return out;
  }

  /**
   * What signing a pledge of the list puts on-chain: the initiative's place in the round,
   * the row as it stands, and the change (the awaiting request's, else "record as it
   * stands" for an open row). 404 when neither applies, 410 once the round has closed, 409
   * while a change to the pledge is in flight.
   *
   * `send`: the change is about to be signed and sent. An awaiting add that is now an edit
   * (`effectiveChange`) is stored as that edit first, so its landing (which clears only a
   * request asking for the very change that landed) clears it.
   */
  async function target(
    d: VoteRound,
    rfpId: string,
    pid: string,
    send = false,
  ): Promise<{
    initiative: Initiative;
    initiativeId: number;
    row: Pledge | null;
    change: PledgeChange;
  }> {
    const m = d.manifest;
    if (deps.now() >= m.closesAt) throw closedFail();
    if (!PLEDGE_ID_RE.test(pid)) throw new HttpError(400, "bad pledge id");
    const initiative = await db.initiatives.get(rfpId);
    const initiativeId = initiative ? m.slugs.indexOf(initiative.slug) : -1;
    if (!initiative || initiativeId < 0) {
      throw new HttpError(404, "That initiative isn't in the round.");
    }
    if (m.kind === "real") await pledges.settle(d, rfpId, pid);
    const row = await db.pledges.get(rfpId, pid);
    const at = { initiative, initiativeId, row };
    if (m.kind === "real") {
      const key = requestKey(d, rfpId, pid);
      const entry = await db.kv.get<PledgeRequest>(key);
      if (entry.value) {
        const change = effectiveChange(entry.value.change, row);
        if (send && change !== entry.value.change) {
          const ok = await db.kv.atomic().check(entry).set(key, { ...entry.value, change })
            .commit();
          if (!ok.ok) {
            throw pledgeFail(
              409,
              "pledge_request_changed",
              "Another admin changed this pledge just now: sign it again.",
            );
          }
        }
        return { ...at, change };
      }
    }
    if (row?.status !== "pledged") throw new HttpError(404, "not found");
    return { ...at, change: RECORD };
  }

  /** The initiative `rfpId` while the round is open: 410 once it has closed, 409
   * `ballot_closed` past the deadline to qualify (the real round), 404 when there is no such
   * initiative. */
  async function claimable(d: VoteRound, rfpId: string) {
    if (deps.now() >= d.manifest.closesAt) throw closedFail();
    if (await pastDeadline(deps, d)) throw ballotClosedFail();
    if (!await db.initiatives.get(rfpId)) throw new HttpError(404, "not found");
  }
  const claimedFail = (c: BallotClaim) =>
    new HttpError(409, `${c.by} is putting it on the ballot.`, {
      code: "ballot_claimed",
      by: c.by,
      at: c.at,
      message: `${c.by} is putting it on the ballot.`,
    });

  /**
   * One round admin at a time puts an initiative on the ballot: `by` claims it for five
   * minutes, or refreshes its own claim. 409 `ballot_claimed` (with who and since when)
   * while another admin holds it. Atomic: two admins never both win.
   */
  async function claim(d: VoteRound, rfpId: string, by: string): Promise<BallotClaim> {
    await claimable(d, rfpId);
    const key = ballotClaimKey(d, rfpId);
    const entry = await db.kv.get<BallotClaim>(key);
    // A lapsed claim is overwritten, still under check(entry): two admins never both win.
    const held = liveClaim(entry.value, deps.now());
    if (held && !sameAddress(held.by, by)) throw claimedFail(held);
    const next = { by, at: deps.now() };
    const ok = await db.kv.atomic().check(entry).set(key, next, { expireIn: BALLOT_CLAIM_MS })
      .commit();
    if (!ok.ok) {
      const won = liveClaim((await db.kv.get<BallotClaim>(key)).value, deps.now());
      if (won) throw claimedFail(won);
      throw new HttpError(409, "Someone else claimed it just now. Try again.");
    }
    return next;
  }

  /** `by` lets its claim go (any outcome); nothing held is fine, another's is 409. */
  async function release(d: VoteRound, rfpId: string, by: string): Promise<void> {
    const key = ballotClaimKey(d, rfpId);
    const entry = await db.kv.get<BallotClaim>(key);
    if (!entry.value) return;
    const held = liveClaim(entry.value, deps.now());
    if (held && !sameAddress(held.by, by)) throw claimedFail(held);
    await db.kv.atomic().check(entry).delete(key).commit();
  }

  return { queue, ready, target, toSign, claim, release };
}
