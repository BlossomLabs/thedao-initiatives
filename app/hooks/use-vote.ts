import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { api, ApiError } from "~/lib/api";
import type { Tier } from "../../shared/vote/ballot";
import type { LiveInputsJson } from "../../shared/vote/live-inputs";

/* The vote's reads and types. Sending a ballot (wallet, signing, the chain client)
 * is in use-vote-send.ts, so a page that only shows the vote doesn't load it. */

export type CodeInfo = { n: number; claimed: boolean; owner: string | null };

/** The paper code's number and whether it is claimed; `bad` for a code the issuer never signed. */
export function useVoteCode(code: string, enabled = true) {
  return useQuery({
    queryKey: ["vote-code", code],
    enabled,
    queryFn: async (): Promise<CodeInfo | "bad"> => {
      try {
        return await api<CodeInfo>(`/api/vote/code/${encodeURIComponent(code)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 400) return "bad";
        throw e;
      }
    },
  });
}

export type VoteBallots = { at: number; ballots: { tokenId: string; ballot: Hex }[] };

/** Every badge's latest ballot sent before the close (the vote results poll it). */
export function useVoteBallots(refetchInterval: number | false = false, enabled = true) {
  return useQuery({
    queryKey: ["vote-ballots"],
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
  }
  | {
    tier: Tier;
    status: "settled";
    at: number;
    forced: boolean;
    funded: string[];
    /** Micro-USD per initiative, as decimal strings. */
    awards: Record<string, string>;
    /** tokenId → slug → micro-USD that badge paid for it (only what it paid). */
    paid?: Record<string, Record<string, string>>;
  };
/** GET /api/vote/round: the quiet ending as it stands. */
export type RoundView = {
  registrationClosesAt: number;
  closed: boolean;
  /** Each voting badge's equal share of the pool, micro-USD. */
  share?: string;
  tiers: RoundTier[];
  /** tokenId → the ballot that counts (hex). */
  accepted: Record<string, string>;
  rejected: {
    tokenId: string;
    nonce: number;
    reason: "tier_settled" | "registration_closed" | "invalid_ballot";
  }[];
  /** The pool on-chain now (micro-USD): what a new ballot's size is judged against. */
  poolUsd?: string;
  live: {
    funded: string[];
    awards: Record<string, string>;
    tiers?: Record<string, Tier>;
    /** tokenId → slug → micro-USD that badge would pay for it if the open tiers settled
     * now (only what it would pay). */
    paid?: Record<string, Record<string, string>>;
    /** Each unsettled initiative's gap to its next tier; absent once the round is closed. */
    next?: Record<string, NextTierEntry>;
    /** How far ahead each initiative in the tier settling now is, micro-USD: how much
     * less backing it could have and stay (only leads of at least $1K). */
    lead?: Record<string, string>;
    /** The live tally's inputs: the browser re-runs it for a donation's preview. Absent
     * once closed, and from servers before it. */
    inputs?: LiveInputsJson;
    /** The donation that gets each initiative one tier higher than the live tally has
     * it (into B-Tier when unfunded): its gap, and who comes in, drops out or moves. For
     * every open initiative not in the tier settling now; absent once closed. */
    give?: Record<string, NextTierEntry>;
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
  return view.final ? false : Math.max(refetchInterval, CLOSED_POLL_MS);
}

/** The round's quiet ending (each tier's state, what counts, what was refused). */
export function useVoteRound(refetchInterval: number | false = false, enabled = true) {
  return useQuery({
    queryKey: ["vote-round"],
    enabled,
    queryFn: () => api<RoundView>("/api/vote/round", { passive: true }),
    refetchInterval: (q) => roundPollInterval(q.state.data, refetchInterval),
    retry: false,
  });
}

/** A review badge's own star ratings, by initiative id (only what it rated). */
export function useBadgeRatings(tokenId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["vote-ratings", tokenId],
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
export function useMyBadges(me: string | null, enabled = true) {
  return useQuery({
    queryKey: ["vote-mine", me?.toLowerCase()],
    enabled: enabled && Boolean(me),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<number[]> => (await api<{ ids: number[] }>("/api/vote/mine")).ids,
  });
}

export const apiCode = (e: unknown): string | undefined =>
  e instanceof ApiError && e.body && typeof e.body === "object" && "code" in e.body
    ? String((e.body as { code: unknown }).code)
    : undefined;
