/** Each initiative of a round now, in slot order: withdrawn at the replay's head, and the
 * tier it is settled in (funded or covered at a settlement). Read from the public round
 * (its few-second cache), so it agrees with what voters see. */
import type { VoteRound } from "./vote-chain.ts";
import type { VoteReplay } from "../routes/vote.ts";
import type { Tier } from "../../shared/vote/ballot.ts";
import { roundJson as replayJson } from "../../shared/vote/replay-round.ts";

export async function roundStanding(d: VoteRound, replay: VoteReplay) {
  const st = await replay(d);
  const body = replayJson(st, d.manifest.slugs);
  const settled = new Map<string, Tier>();
  for (const t of body.tiers) {
    if (t.status !== "settled") continue;
    for (const slug of [...t.funded, ...t.covered]) {
      if (!settled.has(slug)) settled.set(slug, t.tier);
    }
  }
  const withdrawn = new Set(body.live.withdrawn);
  // Every tier settled: the tally is final (and `live` is empty), nothing to withdraw from.
  const final = body.tiers.every((t) => t.status === "settled");
  const last = body.tiers[2];
  const lastWithdrawn = new Set(last.status === "settled" ? last.withdrawn : []);
  return {
    final,
    initiatives: d.manifest.slugs.map((slug) => ({
      slug,
      withdrawn: final ? lastWithdrawn.has(slug) : withdrawn.has(slug),
      settledIn: settled.get(slug) ?? null,
    })),
  };
}
