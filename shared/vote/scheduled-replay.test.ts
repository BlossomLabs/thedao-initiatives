import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/scheduled-replay.json";
import { replay, type RoundState, type Schedule } from "./quiet-ending";

/** The same complete audit the independent Python reference emits. */
function audit(st: RoundState) {
  const stages = (
    order: number[],
    shares: Map<number, Map<string, bigint>>,
    awards: Map<number, bigint>,
  ) => ({
    funded: order,
    shares: Object.fromEntries(
      [...shares].map((
        [c, paid],
      ) => [c, Object.fromEntries([...paid].map(([v, amount]) => [v, String(amount)]))]),
    ),
    awards: Object.fromEntries([...awards].map(([c, amount]) => [c, String(amount)])),
  });
  return {
    tiers: st.tiers.map((t) =>
      t.status !== "settled" ? t : {
        tier: t.tier,
        status: t.status,
        at: t.at,
        forced: t.forced,
        ...stages(t.funded, t.shares, t.awards),
        covered: t.covered,
        withdrawn: t.withdrawn,
      }
    ),
    accepted: Object.fromEntries([...st.accepted].map(([id, b]) => [id, [...b]])),
    rejected: st.rejected,
    share: String(st.share),
    registrationClosesAt: st.registrationClosesAt,
    live: {
      stages: st.tiers.slice(st.firstOpen).map((t) => {
        const order = st.live.order.filter((c) => st.live.tiers.get(c) === t.tier);
        return stages(
          order,
          new Map(order.map((c) => [c, st.live.shares.get(c)!])),
          new Map(order.map((c) => [c, st.live.awards.get(c)!])),
        );
      }),
      covered: st.live.covered,
      withdrawn: st.live.withdrawn,
    },
  };
}

describe("complete scheduled replay agrees with the independent Python reference", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const h = fixture.history;
      const run = () =>
        replay({
          schedule: h.schedule as Schedule,
          m: h.m,
          states: h.states.map((s) => ({
            ...s,
            asks: s.asks.map(BigInt),
            poolUsd: BigInt(s.poolUsd),
            poolInitialized: true,
          })),
          receipts: h.receipts.map((r) => ({
            ...r,
            ballot: r.ballot === null ? null : Uint8Array.from(r.ballot),
          })),
        }, h.now);
      if ("error" in fixture) expect(run).toThrow(fixture.error);
      else expect(audit(run())).toEqual(fixture.expected);
    });
  }
});
