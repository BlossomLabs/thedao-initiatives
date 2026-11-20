import { useRound, useVoteApi, useVoteEnvironment } from "~/lib/vote-round";
import { roundId } from "../../shared/vote/keys";

import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { ApiError } from "~/lib/api";
import type { Tier } from "../../shared/vote/ballot";
import type { ValuationEvidence } from "../../shared/vote/quiet-ending";
import type { LiveInputsJson } from "../../shared/vote/live-inputs";
import type { LastChangeJson } from "../../shared/vote/replay-round";

/* The vote's reads and types. Sending a ballot (wallet, signing, the chain client)
 * is in use-vote-send.ts, so a page that only shows the vote doesn't load it. */

export type VoteBallots = { at: number; ballots: { tokenId: string; ballot: Hex }[] };

/** Every badge's latest ballot sent before the close (the vote results poll it). */
export function useVoteBallots(refetchInterval: number | false = false, enabled = true) {
  const ROUND = useRound();
  const api = useVoteApi();

  return useQuery({
    queryKey: [useVoteEnvironment(), "vote-ballots", roundId(ROUND)],
    queryFn: () => api<VoteBallots>("/api/vote/ballots", { passive: true }),
    refetchInterval,
    retry: false,
    enabled,
  });
}

export type RoundTier =
  | { tier: Tier; status: "waiting"; startsAt: number }
  | {
    tier: Tier;
    status: "settling";
    window: number;
    windowEndsAt: number;
    latestEndAt: number;
    quiet: boolean;
    funded: string[];
    /** Asking $0 at the latest tally: covered by donations. Absent from servers before it. */
    covered?: string[];
    /** Withdrawn by an admin at the latest tally. Absent from servers before it. */
    withdrawn?: string[];
  }
  | {
    tier: Tier;
    status: "settled";
    at: number;
    forced: boolean;
    confirmed?: boolean;
    valuation?: ValuationEvidence;
    funded: string[];
    /** Asking $0 when it settled: covered by donations, final. Absent from servers before it. */
    covered?: string[];
    /** Withdrawn by an admin when it settled (not final: a withdrawal can be undone before
     * the next tier settles). Absent from servers before it. */
    withdrawn?: string[];
    /** Micro-USD per initiative, as decimal strings. */
    awards: Record<string, string>;
    /** tokenId → slug → micro-USD that badge paid for it (only what it paid). */
    paid?: Record<string, Record<string, string>>;
  };
/** GET /api/vote/round: the quiet ending as it stands. */
export type RoundView = {
  /** The newest block the server judged the round at: nothing after it has happened yet,
   * whatever this browser's clock says. Absent from servers before it (and examples). */
  head?: { block: number; timestamp: number };
  finalized?: { block: number; timestamp: number; hash?: string } | null;
  valuation?: ValuationEvidence;
  settlementCoverage?: Record<
    string,
    { awardUsd: string; askUsd: string; shortfallUsd: string; excessAwardUsd: string }
  >;
  poolInitialized: boolean;
  registrationClosesAt: number | null;
  closed: boolean;
  /** Each voting badge's equal share of the pool, micro-USD. */
  share?: string;
  tiers: RoundTier[];
  /** tokenId → the ballot that counts (hex). */
  accepted: Record<string, string>;
  /** Accepted revision per badge; absent only in older responses and examples. */
  acceptedNonces?: Record<string, number>;
  /** How many initiatives each accepted ballot listed as sent: any after it are new to
   * that badge. Absent in older responses. */
  acceptedLengths?: Record<string, number>;
  rejected: {
    tokenId: string;
    nonce: number;
    reason: "tier_settled" | "registration_closed" | "invalid_ballot";
  }[];
  /** The pool on-chain now (micro-USD): what a new ballot's size is judged against. */
  poolUsd?: string;
  /** Each initiative's ask on-chain now (goal less donations and open pledges), micro-USD:
   * what the ballot rules and the live tally count. In manifest order; absent when the
   * chain has fewer projects than the site. */
  asks?: string[];
  /** The contract's withdrawn flags at the head (slugs), a settled project's too: what the
   * ballot rules count. Display uses `live.withdrawn`. Absent from servers before it. */
  withdrawnFlags?: string[];
  live: {
    funded: string[];
    awards: Record<string, string>;
    tiers?: Record<string, Tier>;
    /** tokenId → slug → micro-USD that badge would pay for it if the open tiers settled
     * now (only what it would pay). */
    paid?: Record<string, Record<string, string>>;
    /** Asking $0 now: covered by donations, in no tier. Absent from servers before it. */
    covered?: string[];
    /** Withdrawn by an admin now: in no tier, and not covered. Absent from servers before
     * it (and from a cached closed round's body). */
    withdrawn?: string[];
    /** Each unsettled initiative's gap to its next tier; absent once the round is closed. */
    next?: Record<string, NextTierEntry>;
    /** For each initiative the live tally funds in the tier settling now: a checked
     * donation elsewhere that pushes it out, micro-USD, or null when none was found.
     * Smaller threats can be missed; null is not a safety guarantee. */
    threat?: Record<string, string | null>;
    /** The live tally's inputs: the browser re-runs it for a donation's preview. Absent
     * once closed, and from servers before it. */
    inputs?: LiveInputsJson;
    /** The donation that gets each initiative one tier higher than the live tally has
     * it (into B-Tier when unfunded): its gap, and who comes in, drops out or moves. For
     * every open initiative not in the tier settling now; absent once closed. */
    give?: Record<string, NextTierEntry>;
    /** What caused the last change to TheDAO's ballot, and what it moved; null when none
     * was found in the last few inputs. Absent once closed, from examples and from servers
     * before it. */
    lastChange?: LastChangeJson | null;
    /** `next`, `threat` and `give` are from before the latest change (a ballot, a donation,
     * a pledge, the pool): served while they are worked out again. */
    aheadStale?: boolean;
  };
  /** Once closed: each initiative's gap to the tier above where it finished, judged at
   * that tier's settlement (comesIn/dropsOut name only the target tier), and S-Tier's
   * leads (micro-USD, at least $1K). Absent until computed. */
  final?: { next: Record<string, NextTierEntry>; lead: Record<string, string> };
};

export type NextTierEntry = {
  tier: Tier;
  /** Micro-USD; null when no amount alone gets it there. */
  gap: string | null;
  comesIn: { slug: string; tier: Tier }[];
  dropsOut: { slug: string; tier: Tier }[];
  moves: { slug: string; from: Tier; to: Tier }[];
};

const CLOSED_POLL_MS = 15_000;

/** How often a page that polls every `refetchInterval` asks for the round in `view`'s state. */
export function roundPollInterval(
  view: RoundView | undefined,
  refetchInterval: number | false,
): number | false {
  if (!view?.closed || refetchInterval === false) return refetchInterval;
  // The tally can't change once the round is over, but the final what-ifs are worked
  // out in the background after it closes and only come in a later response: wait for
  // them, at an unhurried pace, then stop.
  const confirmed = (view.tiers ?? []).every((t) =>
    t.status !== "settled" || t.confirmed !== false
  );
  return view.final && confirmed ? false : Math.max(refetchInterval, CLOSED_POLL_MS);
}

/** The round's quiet ending (each tier's state, what counts, what was refused). */
export function useVoteRound(refetchInterval: number | false = false, enabled = true) {
  const ROUND = useRound();
  const api = useVoteApi();

  return useQuery({
    queryKey: [useVoteEnvironment(), "vote-round", roundId(ROUND)],
    enabled,
    queryFn: () => api<RoundView>("/api/vote/round", { passive: true }),
    refetchInterval: (q) => roundPollInterval(q.state.data, refetchInterval),
    retry: false,
  });
}

/** A review badge's own star ratings, by initiative id (only what it rated). */
export function useBadgeRatings(tokenId: string | null, enabled = true) {
  const ROUND = useRound();
  const api = useVoteApi();

  return useQuery({
    queryKey: [useVoteEnvironment(), "vote-ratings", roundId(ROUND), tokenId],
    enabled: enabled && tokenId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const r = await api<{ ratings: Record<string, { mine: number | null }> }>(
        `/api/reviews/ratings?tokenId=${tokenId}`,
      );
      return Object.fromEntries(
        Object.entries(r.ratings).flatMap(([id, x]) => (x.mine ? [[id, x.mine]] : [])),
      );
    },
  });
}

/** The badges the signed-in account votes with in this round (the voting badges it
 * holds in the real vote; its one test badge in a test vote), ascending. Off until
 * `me` is known. */
/** What /api/vote/mine says about the signed-in account: its voting badges, and for each
 * that sent a ballot how many initiatives joined since (only those with some). */
export type Mine = { ids: number[]; fresh?: Record<string, number> };

/** The one request behind the account's badges and their new-initiative counts, cached ten
 * minutes; the vote page refreshes it when this badge's sent ballot changes. */
function useMine<T>(me: string | null, enabled: boolean, select: (m: Mine) => T) {
  const ROUND = useRound();
  const api = useVoteApi();

  return useQuery({
    queryKey: mineKey(useVoteEnvironment(), roundId(ROUND), me),
    enabled: enabled && Boolean(me),
    staleTime: 10 * 60_000,
    queryFn: () => api<Mine>("/api/vote/mine"),
    select,
  });
}
export const mineKey = (env: string, round: string, me: string | null) =>
  [env, "vote-mine", round, me?.toLowerCase()] as const;

const idsOf = (m: Mine) => m.ids;
export function useMyBadges(me: string | null, enabled = true) {
  return useMine(me, enabled, idsOf);
}

/** The most initiatives new to any of the account's badges since it last sent its ballot:
 * the chip beside My ballot. 0 when none, or before a first send. */
const mostFresh = (m: Mine) => Math.max(0, ...Object.values(m.fresh ?? {}));
export function useBallotNews(me: string | null, enabled = true) {
  return useMine(me, enabled, mostFresh);
}

export const apiCode = (e: unknown): string | undefined =>
  e instanceof ApiError && e.body && typeof e.body === "object" && "code" in e.body
    ? String((e.body as { code: unknown }).code)
    : undefined;
