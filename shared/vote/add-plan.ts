import { getAddress, isAddress, stringToHex } from "viem";
import type { Schedule } from "./quiet-ending.ts";
import type { VoteManifest } from "./manifest.ts";
import { testPlaceholder, tierSpan } from "./round-from-chain.ts";

const tierMax = tierSpan;
const placeholder = testPlaceholder;

export type BoardCard = {
  slug: string;
  goalUsd: number;
  safeAddress: string;
  type?: "rfp" | "grant";
  /** The board's raised total (pledges and donations): what qualifies it for the vote. */
  raisedUsd?: number;
  /** From /api/initiatives/affiliations (the board doesn't carry them). */
  affiliations?: string[];
  /** From /api/initiatives/:slug (the board doesn't carry them): the pledge records. */
  pledges?: { id: string; amountUsd: number; status: "pledged" | "received" | "withdrawn" }[];
};
export type PlannedInitiative = {
  slug: string;
  account: `0x${string}`;
  goalUsd: bigint;
  rfp: boolean;
  /** Indexes into the round's group names (one group per affiliation). */
  groups: number[];
};

/** The round's groups: one per affiliation (compared ignoring case, first spelling kept),
 * after the `existing` ones in their order, then in board order. A group name is a
 * bytes32 on-chain. */
export function planGroups(
  cards: BoardCard[],
  existing: string[] = [],
): { names: string[]; groupsOf: (slug: string) => number[] } {
  const names = [...existing];
  const index = new Map(names.map((n, i) => [n.toLowerCase(), i]));
  const bySlug = new Map<string, number[]>();
  for (const c of cards) {
    const ids: number[] = [];
    for (const a of c.affiliations ?? []) {
      if (new TextEncoder().encode(a).length > 32) {
        throw new Error(`${c.slug}: affiliation "${a}" is over 32 bytes`);
      }
      let i = index.get(a.toLowerCase());
      if (i === undefined) {
        i = names.push(a) - 1;
        index.set(a.toLowerCase(), i);
      }
      if (!ids.includes(i)) ids.push(i);
    }
    bySlug.set(c.slug, ids);
  }
  return { names, groupsOf: (slug) => bySlug.get(slug) ?? [] };
}

export const groupMask = (groups: number[]): bigint =>
  groups.reduce((m, g) => m | (1n << BigInt(g)), 0n);

/** Projects may join before opening, or later outside every tier's quiet-ending span
 * [first tally, latest end), never at or after the last end (as the contract checks). */
export function addingOpen(s: Schedule, now: number): boolean {
  const span = tierMax(s);
  if (now < s.opensAt) return true;
  if (now >= s.firstTallyAt[2] + span) return false;
  return s.firstTallyAt.every((t) => now < t || now >= t + span);
}

/** When adding opens again: the end of the span `now` is in; null once the round is over. */
export function nextAddingOpen(s: Schedule, now: number): number | null {
  const span = tierMax(s);
  let t = now;
  // Spans can follow each other with no gap (A starts as S's latest end passes).
  while (!addingOpen(s, t)) {
    if (t >= s.firstTallyAt[2] + span) return null;
    t = s.firstTallyAt.find((x) => t >= x && t < x + span)! + span;
  }
  return t;
}

/** On-chain initiatives in the given order: the Safe when set and unused, else (test
 * votes only) a deterministic placeholder, since the contract needs unique accounts.
 * The real vote pays out to these accounts, so a missing or shared Safe stops it. */
export function planInitiatives(
  cards: BoardCard[],
  { real = false, groups = planGroups(cards) }: {
    real?: boolean;
    groups?: ReturnType<typeof planGroups>;
  } = {},
): PlannedInitiative[] {
  const seen = new Set<string>();
  for (const c of cards) {
    if (c.type === "rfp" && c.affiliations?.length) {
      throw new Error(`${c.slug}: an RFP can't have affiliations`);
    }
  }
  return cards.map((c) => {
    const safe = c.safeAddress && isAddress(c.safeAddress) ? getAddress(c.safeAddress) : null;
    if (real && !safe) throw new Error(`missing Safe: ${c.slug}`);
    if (real && seen.has(safe!.toLowerCase())) throw new Error(`Safe used twice: ${c.slug}`);
    const account = safe && !seen.has(safe.toLowerCase()) ? safe : placeholder(c.slug);
    seen.add(account.toLowerCase());
    return {
      slug: c.slug,
      account,
      goalUsd: BigInt(Math.round(c.goalUsd * 1e6)),
      rfp: c.type === "rfp",
      groups: groups.groupsOf(c.slug),
    };
  });
}

/** Adding projects to a deployed round: the admin's calls (new groups, then each
 * project) and the manifest with them appended (indexes never move). */
export function addPlan(
  m: VoteManifest,
  cards: BoardCard[],
): {
  calls: { fn: "addGroup" | "addInitiative"; args: readonly unknown[] }[];
  manifest: VoteManifest;
} {
  for (const c of cards) {
    if (m.slugs.includes(c.slug)) throw new Error(`${c.slug} is already in the round`);
  }
  const groups = planGroups(cards, m.groups);
  const plan = planInitiatives(cards, { real: m.kind === "real", groups });
  const calls = [
    ...groups.names.slice(m.groups.length).map((n) => ({
      fn: "addGroup" as const,
      args: [stringToHex(n, { size: 32 })] as const,
    })),
    ...plan.map((p) => ({
      fn: "addInitiative" as const,
      args: [p.account, p.goalUsd, p.rfp, groupMask(p.groups)] as const,
    })),
  ];
  return {
    calls,
    manifest: {
      ...m,
      slugs: [...m.slugs, ...plan.map((p) => p.slug)],
      projects: [
        ...m.projects,
        ...plan.map((p) => ({ goalUsd: p.goalUsd.toString(), rfp: p.rfp, groups: p.groups })),
      ],
      groups: groups.names,
      ...(m.accounts ? { accounts: [...m.accounts, ...plan.map((p) => p.account)] } : {}),
    },
  };
}

export type AddBlocker =
  | { kind: "no-safe" }
  | { kind: "safe-used" }
  | { kind: "rfp-affiliations" }
  | { kind: "closed"; opensAt: number | null }
  | { kind: "already" };

/** Why `card` can't be added to the round now, or null when it can. */
export function addBlocker(m: VoteManifest, card: BoardCard, now: number): AddBlocker | null {
  if (m.slugs.includes(card.slug)) return { kind: "already" };
  if (card.type === "rfp" && card.affiliations?.length) return { kind: "rfp-affiliations" };
  const safe = card.safeAddress && isAddress(card.safeAddress) ? card.safeAddress : null;
  if (!safe && m.kind === "real") return { kind: "no-safe" };
  if (safe && m.accounts?.some((a) => a.toLowerCase() === safe.toLowerCase())) {
    return { kind: "safe-used" };
  }
  if (!addingOpen(m.schedule, now)) {
    return { kind: "closed", opensAt: nextAddingOpen(m.schedule, now) };
  }
  return null;
}
