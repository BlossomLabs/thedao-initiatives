/** The ballot rules (docs/superpowers/specs/2026-11-11-ballot-rules-design.md): a valid
 * ballot requests at least 1.5× the pool, and each enforced tier (Tier-S always, Tier-A
 * when the round says so) holds at least 3 pairwise-unrelated projects with no related
 * group over half its funds. Related = sharing a group (an affiliation); RFPs have none. Mirrored by
 * vote/reference/ballot_rules.py and the contract; shared fixtures keep them equal.
 * Amounts are micro-USD bigints. Browser and Deno. */

export type RulesProject = { askUsd: bigint; rfp: boolean; groups: number[] };
export type RulesRound = {
  projects: RulesProject[];
  groupNames: string[];
  poolUsd: bigint;
  /** Bit 0 Tier-S, bit 1 Tier-A. Tier-B is never checked. */
  independentTiers: number;
};
export type RuleError =
  | { rule: "shape" }
  | { rule: "tiers" }
  | { rule: "size"; requested: bigint; needed: bigint; pool: bigint }
  | {
    rule: "independent";
    tier: 0 | 1;
    count: number;
    related: { group: number; projects: number[] }[];
  }
  | { rule: "group"; tier: 0 | 1; group: number; groupUsd: bigint; tierUsd: bigint };
export type RulesResult = { ok: boolean; errors: RuleError[]; proof: number[] };

const WITHHELD = 255;

/** Project indexes per group of equal rank, best rank first. */
export function tiersOf(ballot: Uint8Array): number[][] {
  const byRank = new Map<number, number[]>();
  ballot.forEach((r, i) => {
    if (r !== WITHHELD) byRank.set(r, [...(byRank.get(r) ?? []), i]);
  });
  return [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r)!);
}

/** Every byte unplaced or a competition rank in 1..m without gaps; no longer than m. */
function readable(ballot: Uint8Array, m: number): boolean {
  if (ballot.length === 0 || ballot.length > m) return false;
  if ([...ballot].some((r) => r !== WITHHELD && (r < 1 || r > m))) return false;
  let seen = 0;
  for (const group of tiersOf(ballot)) {
    if (ballot[group[0]] !== seen + 1) return false;
    seen += group.length;
  }
  return true;
}

const mask = (p: RulesProject) => p.groups.reduce((a, g) => a | (1n << BigInt(g)), 0n);
const related = (round: RulesRound, a: number, b: number) =>
  (mask(round.projects[a]) & mask(round.projects[b])) !== 0n;
const enforced = (round: RulesRound) =>
  ([0, 1] as const).filter((t) => (round.independentTiers >> t) & 1);

/** The first pairwise-unrelated triple in index order, else the largest such set's size. */
function independent(round: RulesRound, tier: number[]): { proof?: number[]; count: number } {
  const n = tier.length;
  let count = Math.min(n, 1);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (related(round, tier[i], tier[j])) continue;
      count = Math.max(count, 2);
      for (let k = j + 1; k < n; k++) {
        if (!related(round, tier[i], tier[k]) && !related(round, tier[j], tier[k])) {
          return { proof: [tier[i], tier[j], tier[k]], count: 3 };
        }
      }
    }
  }
  return { count };
}

export function checkBallot(ballot: Uint8Array, round: RulesRound): RulesResult {
  if (!readable(ballot, round.projects.length)) {
    return { ok: false, errors: [{ rule: "shape" }], proof: [] };
  }
  const errors: RuleError[] = [];
  const groups = tiersOf(ballot);
  if (groups.length > 3) errors.push({ rule: "tiers" });
  const ask = (i: number) => round.projects[i].askUsd;
  const sum = (xs: number[]) => xs.reduce((a, i) => a + ask(i), 0n);
  const requested = sum(groups.flat());
  if (2n * requested < 3n * round.poolUsd) {
    errors.push({
      rule: "size",
      requested,
      needed: (3n * round.poolUsd + 1n) / 2n,
      pool: round.poolUsd,
    });
  }
  const proof: number[] = [];
  for (const t of enforced(round)) {
    const tier = groups[t] ?? [];
    const found = independent(round, tier);
    const byGroup = new Map<number, number[]>();
    for (const i of tier) {
      for (const g of round.projects[i].groups) byGroup.set(g, [...(byGroup.get(g) ?? []), i]);
    }
    const ids = [...byGroup.keys()].sort((a, b) => a - b);
    if (found.proof) proof.push(...found.proof);
    else {
      errors.push({
        rule: "independent",
        tier: t,
        count: found.count,
        related: ids.filter((g) => byGroup.get(g)!.length >= 2)
          .map((g) => ({ group: g, projects: byGroup.get(g)! })),
      });
    }
    const tierUsd = sum(tier);
    for (const g of ids) {
      const groupUsd = sum(byGroup.get(g)!);
      if (2n * groupUsd > tierUsd) {
        errors.push({ rule: "group", tier: t, group: g, groupUsd, tierUsd });
      }
    }
  }
  return errors.length ? { ok: false, errors, proof: [] } : { ok: true, errors, proof };
}

/** The proof the contract wants for this ballot (three unrelated projects per enforced
 * tier, Tier-S first), whatever the pool; null when a tier has no unrelated triple or the
 * ballot can't be read. */
export function findProof(ballot: Uint8Array, round: RulesRound): number[] | null {
  if (!readable(ballot, round.projects.length)) return null;
  const groups = tiersOf(ballot);
  const proof: number[] = [];
  for (const t of enforced(round)) {
    const found = independent(round, groups[t] ?? []).proof;
    if (!found) return null;
    proof.push(...found);
  }
  return proof;
}

/** Whether `proof` names, for each enforced tier in order, three pairwise-unrelated
 * projects in that tier: what the contract checks instead of searching. */
export function checkProof(ballot: Uint8Array, round: RulesRound, proof: number[]): boolean {
  const tiers = enforced(round);
  if (proof.length !== 3 * tiers.length) return false;
  const groups = tiersOf(ballot);
  return tiers.every((t, k) => {
    const [a, b, c] = proof.slice(3 * k, 3 * k + 3);
    const tier = new Set(groups[t] ?? []);
    return [a, b, c].every((x) => tier.has(x)) && a !== b && a !== c && b !== c &&
      !related(round, a, b) && !related(round, a, c) && !related(round, b, c);
  });
}

/** What the bytes can't show: an enforced tier the voter left empty. On-chain ranks only
 * keep groups, so an empty Tier-S makes Tier-A the first group (read as Tier-S); the
 * spec makes such a ballot invalid, so the page refuses it by label. */
export function emptyTierErrors(
  tiers: Partial<Record<string, "S" | "A" | "B">>,
  independentTiers: number,
): RuleError[] {
  const used = new Set(Object.values(tiers));
  return ([0, 1] as const)
    .filter((t) => (independentTiers >> t) & 1 && !used.has((["S", "A"] as const)[t]))
    .map((tier) => ({ rule: "independent", tier, count: 0, related: [] }));
}
