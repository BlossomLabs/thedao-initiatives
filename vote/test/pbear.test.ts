import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { fileURLToPath } from "node:url";
const NONE = (1n << 64n) - 1n;
import { cumulativeDeductions, pbearTranscript, replayPublic } from "../shared/pbear";
import { effectiveRanks, validate, WITHHELD } from "../shared/ranks";

describe("pbear transcript", () => {
  test("the [30, 70] example", () => {
    const { funded, transcript } = pbearTranscript([30n, 70n], [{ weight: 40n, ballot: [1, 2] }], [{ weight: 60n, ballot: [2, 1] }], 100n);
    expect(funded).toEqual([0, 1]);
    expect(transcript).toEqual([[1n, 40n, 0n, 0n, 40n], [1n, 0n, 0n, NONE, 0n], [2n, 0n, 10n, 1n, 70n]]);
    expect(replayPublic([30n, 70n], [{ weight: 40n, ballot: [1, 2] }], transcript, 100n)).toBe(true);
  });
  test("audit rejects a tampered transcript", () => {
    const costs = [30n, 70n];
    const pub = [{ weight: 40n, ballot: [1, 2] }];
    const budget = 100n;
    const valid: bigint[][] = [
      [1n, 40n, 0n, 0n, 40n],
      [1n, 0n, 0n, NONE, 0n],
      [2n, 0n, 10n, 1n, 70n],
    ];
    expect(replayPublic(costs, pub, valid, budget)).toBe(true);

    const tamperedSupport = valid.map((row) => [...row]);
    tamperedSupport[0][1] = 41n; // pubSupport[0] no longer matches what the public ballots support
    expect(replayPublic(costs, pub, tamperedSupport, budget)).toBe(false);

    const tamperedBest = valid.map((row) => [...row]);
    tamperedBest[0][3] = 1n; // best funded project doesn't match the recorded total
    expect(replayPublic(costs, pub, tamperedBest, budget)).toBe(false);
  });
  test("deductions sum to the threshold", () => {
    const d = cumulativeDeductions([7n, 5n, 9n], 10n);
    expect(d.reduce((a, b) => a + b, 0n)).toBe(10n);
  });
  test("matches reference/pbear.py --transcript on random instances", () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 60; i++) {
      const m = 1 + rnd(4);
      const costs = Array.from({ length: m }, () => BigInt(1 + rnd(10)));
      const entry = () => {
        const weight = BigInt(rnd(11));
        if (rnd(5) === 0) return { weight, ballot: null };
        const order = Array.from({ length: m }, (_, c) => c).sort(() => rnd(3) - 1);
        const kept = rnd(m + 1);
        const ranks = new Array<number>(m).fill(0);
        let rank = 1;
        for (let p = 0; p < kept; p++) {
          if (p === 0 || rnd(10) < 6) rank = p + 1;
          ranks[order[p]] = rank;
        }
        return { weight, ballot: ranks };
      };
      const pub = Array.from({ length: rnd(4) }, entry);
      const sealed = Array.from({ length: rnd(4) }, entry);
      const budget = [...pub, ...sealed].reduce((a, e) => a + e.weight, 0n) + BigInt(rnd(10));
      const payload = JSON.stringify({ costs: costs.map(Number), public: pub.map((e) => [Number(e.weight), e.ballot]), sealed: sealed.map((e) => [Number(e.weight), e.ballot]), budget: Number(budget) });
      const out = spawnSync(["python3", fileURLToPath(new URL("../reference/pbear.py", import.meta.url)), "--transcript", payload]);
      const ref = JSON.parse(out.stdout.toString());
      const got = pbearTranscript(costs, pub, sealed, budget);
      expect(got.funded).toEqual(ref.funded);
      expect(got.transcript.map((s) => s.map(Number))).toEqual(ref.transcript);
    }
  });
  test("withheld projects are outside the ranking", () => {
    expect(validate([1, WITHHELD, 2, 0], 4)).toBe(true);
    expect(validate([WITHHELD, WITHHELD, WITHHELD, WITHHELD], 4)).toBe(true);
    expect(validate([1, WITHHELD, 3, 0], 4)).toBe(false);
    expect(validate([1, 254, 2, 0], 4)).toBe(false);
    expect(effectiveRanks([1, WITHHELD, 2, 0], 4)).toEqual([1, WITHHELD, 2, 3]);
  });
  test("leftover money funds an unranked project unless it is withheld", () => {
    const costs = [4n, 6n];
    const open = [{ weight: 5n, ballot: [1, 0] }, { weight: 5n, ballot: [1, 0] }];
    expect(pbearTranscript(costs, open, [], 10n).funded).toEqual([0, 1]);
    const withheld = [{ weight: 5n, ballot: [1, 0] }, { weight: 5n, ballot: [1, WITHHELD] }];
    const { funded, transcript } = pbearTranscript(costs, withheld, [], 10n);
    expect(funded).toEqual([0]);
    expect(replayPublic(costs, withheld, transcript, 10n)).toBe(true);
  });
  test("withholding matches reference/withhold.py --transcript, the unchanged reference on padded ballots", () => {
    let seed = 987654;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    let withheldRounds = 0;
    for (let i = 0; i < 200; i++) {
      const m = 1 + rnd(5);
      const costs = Array.from({ length: m }, () => BigInt(1 + rnd(10)));
      const entry = () => {
        const weight = BigInt(rnd(11));
        if (rnd(5) === 0) return { weight, ballot: null };
        const order = Array.from({ length: m }, (_, c) => c).sort(() => rnd(3) - 1);
        const kept = rnd(m + 1);
        const ranks = new Array<number>(m).fill(0);
        let rank = 1;
        for (let p = 0; p < kept; p++) {
          if (p === 0 || rnd(10) < 6) rank = p + 1;
          ranks[order[p]] = rank;
        }
        // A third withhold everything unranked, a third some, a third nothing.
        const habit = rnd(3);
        for (let c = 0; c < m; c++) {
          if (ranks[c] === 0 && (habit === 0 || (habit === 1 && rnd(2) === 0))) ranks[c] = WITHHELD;
        }
        return { weight, ballot: ranks };
      };
      const pub = Array.from({ length: rnd(5) }, entry);
      const sealed = Array.from({ length: rnd(5) }, entry);
      if ([...pub, ...sealed].some((e) => e.ballot?.includes(WITHHELD))) withheldRounds++;
      const budget = [...pub, ...sealed].reduce((a, e) => a + e.weight, 0n) + BigInt(rnd(10));
      const payload = JSON.stringify({ costs: costs.map(Number), public: pub.map((e) => [Number(e.weight), e.ballot]), sealed: sealed.map((e) => [Number(e.weight), e.ballot]), budget: Number(budget) });
      const out = spawnSync(["python3", fileURLToPath(new URL("../reference/withhold.py", import.meta.url)), "--transcript", payload]);
      const ref = JSON.parse(out.stdout.toString());
      const got = pbearTranscript(costs, pub, sealed, budget);
      expect(got.funded).toEqual(ref.funded);
      expect(got.transcript.map((s) => s.map(Number))).toEqual(ref.transcript);
      expect(replayPublic(costs, pub, got.transcript, budget)).toBe(true);
    }
    expect(withheldRounds).toBeGreaterThan(100);
  }, 120_000);
});
