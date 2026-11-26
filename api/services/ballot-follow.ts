/** On the ballot the site follows the round (#149): each initiative's goal, RFP or grant,
 * and the affiliations it shares with others are copied from the production round into
 * its row. The Safe never is (it is set once, from the initiative's id). A goal request
 * the round now has is settled. */
import type { Db } from "../db/mod.ts";
import type { Initiative } from "../db/types.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { dropGoalRequest, goalRequests } from "./goal-requests.ts";

export type FollowChange = {
  slug: string;
  field: "goalUsd" | "type" | "affiliations";
  from: unknown;
  to: unknown;
};

/** The names of initiative `i`'s groups that another initiative holds too. A group only
 * it holds (its team's own, #147) stays on the round only. */
export function sharedGroups(m: VoteManifest, i: number): string[] {
  const holders = (g: number) => m.projects.filter((p) => p.groups.includes(g)).length;
  return m.projects[i].groups.filter((g) => holders(g) > 1).map((g) => m.groups[g]);
}

/** Micro-USD on the round → the site's dollars (cents kept). */
const dollars = (micro: string) => Number(BigInt(micro) / 10_000n) / 100;
const sameNames = (a: string[], b: string[]) => {
  const key = (xs: string[]) => xs.map((x) => x.toLowerCase()).sort().join("\n");
  return key(a) === key(b);
};

export async function followRound(db: Db, m: VoteManifest): Promise<FollowChange[]> {
  if (m.kind !== "real") return [];
  const changes: FollowChange[] = [];
  const goals = new Map<string, number>();
  const rows = await Promise.all(m.slugs.map((slug) => db.initiatives.bySlug(slug)));
  for (const [i, slug] of m.slugs.entries()) {
    const row = rows[i];
    if (!row) continue;
    const p = m.projects[i];
    const goal = dollars(p.goalUsd);
    goals.set(row.id, goal);
    const type: Initiative["type"] = p.rfp ? "rfp" : "grant";
    // A group only this initiative holds is left out of the copy, and a site affiliation
    // naming one stays: neither counts as a difference.
    const own = new Set(
      p.groups.map((g) => m.groups[g].toLowerCase()).filter((g) =>
        !sharedGroups(m, i).some((s) => s.toLowerCase() === g)
      ),
    );
    const affiliations = [
      ...sharedGroups(m, i),
      ...(row.affiliations ?? []).filter((a) => own.has(a.toLowerCase())),
    ];
    const patch: Partial<Initiative> = {};
    const note = (field: FollowChange["field"], from: unknown, to: unknown) =>
      changes.push({ slug, field, from, to });
    if (row.goalUsd !== goal) {
      patch.goalUsd = goal;
      note("goalUsd", row.goalUsd, goal);
    }
    if (row.type !== type) {
      patch.type = type;
      note("type", row.type, type);
    }
    if (!sameNames(row.affiliations ?? [], affiliations)) {
      patch.affiliations = affiliations;
      note("affiliations", row.affiliations ?? [], affiliations);
    }
    if (Object.keys(patch).length) await db.initiatives.update(row.id, patch);
  }
  for (const r of await goalRequests(db, m)) {
    if (goals.get(r.rfpId) === r.goalUsd) await dropGoalRequest(db, r.rfpId);
  }
  return changes;
}
