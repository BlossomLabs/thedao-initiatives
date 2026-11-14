import { describe, expect, it } from "vitest";
import { effectiveRanks } from "../../vote/shared/ranks";
import { type ChainInputs, chainTally } from "./chain";
import { liveInputsFrom, liveInputsJson } from "./live-inputs";
import { giftEffect, giftGaps, giftGapTo, STEP } from "./next-tier";

const K = STEP;
function inputs(costsK: number[], weightsK: number[], ballots: number[][], poolK = 100) {
  const m = costsK.length;
  return {
    m,
    costs: costsK.map((c) => BigInt(Math.round(c * 1000)) * 1_000_000n),
    voters: weightsK.map((_, i) => `v${i}`),
    weights: weightsK.map((w) => BigInt(Math.round(w * 1000)) * 1_000_000n),
    ranks: ballots.map((b) => effectiveRanks(b, m)),
    ballots,
    poolUsd: BigInt(poolK) * K,
    spent: 0n,
    done: new Set<number>(),
  } satisfies ChainInputs;
}

describe("the live inputs as JSON", () => {
  it("come back as the same inputs, ranks derived from the ballots", () => {
    const inp = {
      ...inputs([40, 40, 30], [25, 25], [[1, 2, 3], [2, 1, 255]], 60),
      done: new Set([2]),
    };
    const back = liveInputsFrom(JSON.parse(JSON.stringify(liveInputsJson(inp, 1))));
    expect(back.first).toBe(1);
    expect(back.inp).toEqual(inp);
    expect(chainTally(back.inp, 1)).toEqual(chainTally(inp, 1));
  });
});

describe("what a donation does, at any amount", () => {
  it("at the gap, says what the donation search says", () => {
    for (
      const inp of [
        inputs([70, 40], [40], [[1, 2]]),
        inputs([40, 40, 30], [25, 25], [[1, 2, 3], [2, 1, 3]], 60),
      ]
    ) {
      for (const [c, g] of giftGaps(inp, 0)) {
        if (g.gap === null) continue;
        const e = giftEffect(inp, 0, c, g.gap);
        // Its target tier or higher, as the search counts reaching it.
        const order = ["S", "A", "B"];
        expect(order.indexOf(e.tier!)).toBeLessThanOrEqual(order.indexOf(g.tier));
        expect(e.comesIn).toEqual(g.comesIn);
        expect(e.dropsOut).toEqual(g.dropsOut);
        expect(e.moves).toEqual(g.moves);
      }
    }
  });

  it("money freed by a donation to a funded initiative can bring another one in", () => {
    // 0 ($50K) is funded in S-Tier; 1 ($20K) doesn't fit in the $10K the pool has left.
    const inp = inputs([50, 20], [60], [[1, 2]], 60);
    const none = giftEffect(inp, 0, 0, 0n);
    expect(none.tier).toBe("S");
    expect(none.comesIn).toEqual([]);
    const e = giftEffect(inp, 0, 0, 10n * K);
    // It stays where it was, and 1 comes in with what it freed.
    expect(e.was).toBe("S");
    expect(e.tier).toBe("S");
    expect(e.comesIn.map(([o]) => o)).toEqual([1]);
    // Less than that frees too little.
    expect(giftEffect(inp, 0, 0, 9n * K).comesIn).toEqual([]);
  });
});

describe("the donation to any tier", () => {
  it("is the least $1K step that gets it there or higher, more for a higher tier", () => {
    const inp = inputs([50, 20, 45], [30, 30], [[1, 2, 3], [3, 1, 2]], 100);
    const order = (t: string | null) => (t === null ? 3 : ["S", "A", "B"].indexOf(t));
    for (let c = 0; c < 3; c++) {
      let before = 0n;
      for (const target of [2, 1, 0]) {
        const gap = giftGapTo(inp, 0, c, target);
        if (gap === null) continue;
        expect(gap % K).toBe(0n);
        expect(order(giftEffect(inp, 0, c, gap).tier)).toBeLessThanOrEqual(target);
        if (gap > K) expect(order(giftEffect(inp, 0, c, gap - K).tier)).toBeGreaterThan(target);
        expect(gap >= before).toBe(true);
        before = gap;
      }
    }
  });
});
