/**
 * Awaiting pledge requests. During the real vote a pledge to an initiative on the ballot is
 * put on-chain with a round admin's signature (./admin-pledges.ts). A site admin whose
 * wallet lacks the round's PLEDGE_ROLE saves the change as a request instead: held here,
 * seen only on the admin pages, the pledge row left as it is, until a round admin signs it
 * and it lands (the settle that applies it deletes the request).
 *
 * At most one request per pledge: a later change merges into it or replaces it.
 */
import type { Hex } from "viem";
import type { Deps } from "../middleware/context.ts";
import type { Pledge, PledgeStatus } from "../db/types.ts";
import { roundKey } from "../../shared/vote/keys.ts";
import { HttpError } from "../lib/errors.ts";
import type { VoteRound } from "./vote-chain.ts";
import type { PledgeChange } from "./admin-pledges.ts";

export type PledgeRequest = {
  rfpId: string;
  pid: string;
  change: PledgeChange;
  /** The asking admin's address. */
  by: Hex;
  /** Unix seconds. */
  at: number;
  /** Why its last signed send failed (refused, reverted or expired), and when (unix
   * seconds). A later change or a landing clears it. */
  lastError?: string;
  lastErrorAt?: number;
};

/** A request, for the admin pages. Amounts are what goes on-chain: a received or
 * withdrawn pledge counts 0 (`onChainAmount`). */
export type AwaitingPledgeJson = {
  pid: string;
  kind: PledgeChange["kind"];
  company: string;
  /** What the pledge counts on-chain after the change; null for a remove. */
  amountUsd: number | null;
  /** What it counts on-chain now, per its row; null for an add. */
  fromUsd: number | null;
  /** Its status after the change; null for a remove. */
  status: PledgeStatus | null;
  by: string;
  at: number;
  lastError: string | null;
  lastErrorAt: number | null;
};

/** Under the round's own records, next to `pledge-pending` (kept by backups; a new round
 * starts with none). */
const requestPrefix = (d: VoteRound, rfpId?: string) => [
  ...roundKey(d.manifest),
  "pledge-request",
  ...(rfpId === undefined ? [] : [rfpId]),
];
export const requestKey = (d: VoteRound, rfpId: string, pid: string) => [
  ...requestPrefix(d, rfpId),
  pid,
];

/**
 * A change on top of the request already held for the pledge. An edit merges into an
 * awaiting edit (later fields win) or into an awaiting add's row; a remove of an awaiting
 * add leaves nothing (null: nothing was on-chain or saved); anything else replaces it.
 */
export function mergeChange(prev: PledgeChange | null, next: PledgeChange): PledgeChange | null {
  if (!prev) return next;
  if (prev.kind === "add") {
    // Removed or withdrawn before it was ever signed: nothing to record.
    if (next.kind === "remove" || (next.kind === "edit" && next.status === "withdrawn")) {
      return null;
    }
    if (next.kind === "edit") {
      return {
        kind: "add",
        row: { ...prev.row, ...next.patch, status: next.status ?? prev.row.status },
      };
    }
    return next;
  }
  if (prev.kind === "edit" && next.kind === "edit") {
    const status = next.status ?? prev.status;
    return {
      kind: "edit",
      patch: { ...prev.patch, ...next.patch },
      ...(status === undefined ? {} : { status }),
    };
  }
  return next;
}

/** Canonical JSON: keys sorted, undefined fields dropped. */
const canon = (v: unknown): string =>
  JSON.stringify(
    v,
    (_k, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1))
        : x,
  );
/** Is a signed change the one a request asks for? Only then does its landing clear the
 * request: a request changed after the signature stays, for a new one. */
export const sameChange = (a: PledgeChange, b: PledgeChange) => canon(a) === canon(b);

/**
 * The change a request asks for, given the pledge's row now. An awaiting add whose row
 * exists (an earlier version of it landed) can't be added again: it is an edit of that row
 * to the add's fields and status.
 */
export function effectiveChange(change: PledgeChange, row: Pledge | null): PledgeChange {
  if (change.kind !== "add" || !row) return change;
  const { company, amountUsd, note, url, logoCid, status } = change.row;
  return { kind: "edit", patch: { company, amountUsd, note, url, logoCid }, status };
}

/** What a pledge counts on-chain, in USD: `onChainAmount` (./admin-pledges.ts) / 1e6. */
const onChainUsd = (status: PledgeStatus, amountUsd: number) =>
  status === "pledged" ? amountUsd : 0;

/** The requests as the admin pledges table shows them, `rows` the initiative's pledges. */
export function awaitingPledgesJson(
  reqs: PledgeRequest[],
  rows: Pledge[],
): AwaitingPledgeJson[] {
  return reqs.map((r) => {
    const cur = rows.find((p) => p.id === r.pid) ?? null;
    const c = r.change;
    const base = {
      pid: r.pid,
      kind: c.kind,
      by: r.by,
      at: r.at,
      lastError: r.lastError ?? null,
      lastErrorAt: r.lastErrorAt ?? null,
    };
    if (c.kind === "add") {
      return {
        ...base,
        company: c.row.company,
        amountUsd: onChainUsd(c.row.status, c.row.amountUsd),
        fromUsd: null,
        status: c.row.status,
      };
    }
    const fromUsd = cur ? onChainUsd(cur.status, cur.amountUsd) : null;
    if (c.kind === "remove") {
      return { ...base, company: cur?.company ?? "", amountUsd: null, fromUsd, status: null };
    }
    const status = c.status ?? cur?.status ?? "pledged";
    return {
      ...base,
      company: c.patch.company ?? cur?.company ?? "",
      amountUsd: onChainUsd(status, c.patch.amountUsd ?? cur?.amountUsd ?? 0),
      fromUsd,
      status,
    };
  });
}

export function pledgeRequests(deps: Deps) {
  const kv = deps.db.kv;
  return {
    async put(d: VoteRound, req: PledgeRequest): Promise<void> {
      await kv.set(requestKey(d, req.rfpId, req.pid), req);
    },
    async get(d: VoteRound, rfpId: string, pid: string): Promise<PledgeRequest | null> {
      return (await kv.get<PledgeRequest>(requestKey(d, rfpId, pid))).value;
    },
    /** The initiative's requests, or every one in the round. */
    async list(d: VoteRound, rfpId?: string): Promise<PledgeRequest[]> {
      const out: PledgeRequest[] = [];
      for await (const e of kv.list<PledgeRequest>({ prefix: requestPrefix(d, rfpId) })) {
        out.push(e.value);
      }
      return out;
    },
    /** False when there was none. */
    async discard(d: VoteRound, rfpId: string, pid: string): Promise<boolean> {
      const key = requestKey(d, rfpId, pid);
      for (let tries = 0; tries < 3; tries++) {
        const e = await kv.get(key);
        if (e.versionstamp === null) return false;
        if ((await kv.atomic().check(e).delete(key).commit()).ok) return true;
      }
      throw new HttpError(409, "This awaiting pledge changed just now: try again.");
    },
  };
}
