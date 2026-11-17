import { describe, expect, test } from "vitest";
import {
  decodeBallot,
  encodeBallot,
  encodeBallotForSend,
  freshDraft,
  isValidBallotShape,
  sendableBallot,
  sendableTiers,
  type Tier,
} from "./ballot.ts";
import { checkBallot } from "./rules.ts";

const slugs = ["a", "b", "c", "d"];

describe("ballots", () => {
  test("tiers become competition ranks, unplaced is 255", () => {
    expect([...encodeBallot(slugs, { a: "A", b: "S", c: "S" })]).toEqual([3, 1, 1, 255]);
    expect([...encodeBallot(slugs, { d: "B" })]).toEqual([255, 255, 255, 1]);
    expect([...encodeBallot(slugs, { a: "B", b: "A", c: "S", d: "S" })]).toEqual([4, 3, 1, 1]);
  });

  test("an empty ballot withholds everything", () => {
    expect([...encodeBallot(slugs, {})]).toEqual([255, 255, 255, 255]);
  });

  test("tiers for unknown slugs are ignored", () => {
    expect([...encodeBallot(slugs, { zzz: "S" } as Record<string, Tier>)]).toEqual([
      255,
      255,
      255,
      255,
    ]);
  });

  test("encoded ballots never contain 0 and are valid on-chain", () => {
    const tiers: (Tier | undefined)[] = ["S", "A", "B", undefined];
    for (let i = 0; i < 256; i++) {
      const t: Record<string, Tier> = {};
      slugs.forEach((s, k) => {
        const tier = tiers[(i >> (2 * k)) & 3];
        if (tier) t[s] = tier;
      });
      const b = encodeBallot(slugs, t);
      expect(b.includes(0)).toBe(false);
      expect(isValidBallotShape(b, 4)).toBe(true);
      // Ranks keep order, not tier names: decoding round-trips the bytes.
      expect([...encodeBallot(slugs, decodeBallot(b, slugs))]).toEqual([...b]);
    }
  });

  test("decoding keeps tier names when every higher tier is filled", () => {
    expect(decodeBallot(Uint8Array.from([3, 1, 1, 4]), slugs)).toEqual({
      a: "A",
      b: "S",
      c: "S",
      d: "B",
    });
    expect(decodeBallot(Uint8Array.from([255, 1, 255, 255]), slugs)).toEqual({ b: "S" });
  });

  test("shape validation accepts short competition-rank ballots and at most three groups", () => {
    expect(isValidBallotShape(Uint8Array.from([1, 1, 3, 255]), 4)).toBe(true);
    expect(isValidBallotShape(Uint8Array.from([255, 255, 255, 255]), 4)).toBe(true);
    expect(isValidBallotShape(Uint8Array.from([0, 255, 255, 255]), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([2, 255, 255, 255]), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([1, 1, 2, 255]), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([5, 1, 1, 1]), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([1, 255, 255]), 4)).toBe(true);
    expect(isValidBallotShape(new Uint8Array(), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([1, 1, 1, 1, 1]), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([1, 2, 3, 4]), 4)).toBe(false);
    expect(isValidBallotShape(Uint8Array.from([1, 1, 3, 4]), 4)).toBe(true);
  });
});

describe("withdrawn initiatives on a ballot", () => {
  const six = ["p0", "p1", "p2", "p3", "p4", "p5"];
  // S-Tier settled: p0–p2 (rank 1); A-Tier open: p3 (withdrawn) and p4 (rank 4); B-Tier:
  // p5 (rank 6).
  const tiers: Partial<Record<string, Tier>> = {
    p0: "S",
    p1: "S",
    p2: "S",
    p3: "A",
    p4: "A",
    p5: "B",
  };

  test("one in an open tier is dropped on send, and the ranks below it move up", () => {
    expect([...encodeBallot(six, tiers)]).toEqual([1, 1, 1, 4, 4, 6]);
    const sent = sendableBallot(six, tiers, new Set(["p3"]), new Set<Tier>(["S"]));
    expect([...sent]).toEqual([1, 1, 1, 255, 4, 5]);
    expect(isValidBallotShape(sent, six.length)).toBe(true);
    const round = {
      projects: six.map(() => ({ goalUsd: 1n, rfp: false, groups: [] })),
      asks: six.map(() => 1n),
      groupNames: [],
      poolUsd: 0n,
      independentTiers: 1,
    };
    expect(checkBallot(sent, round).errors).not.toContainEqual({ rule: "shape" });
  });

  test("one in a settled tier stays where it is: the lock needs that tier unchanged", () => {
    const sent = sendableBallot(six, tiers, new Set(["p1"]), new Set<Tier>(["S"]));
    expect([...sent]).toEqual([1, 1, 1, 4, 4, 6]);
  });

  test("one alone in an open tier with picks below stays as a placeholder: they keep their tier", () => {
    // A-Tier holds only p3 (withdrawn), B-Tier p5: dropping p3 would read p5 as A-Tier.
    const alone: Partial<Record<string, Tier>> = { p0: "S", p1: "S", p2: "S", p3: "A", p5: "B" };
    const settled = new Set<Tier>(["S"]);
    expect(sendableTiers(alone, new Set(["p3"]), settled)).toBe(alone);
    expect([...sendableBallot(six, alone, new Set(["p3"]), settled)]).toEqual([
      1,
      1,
      1,
      4,
      255,
      5,
    ]);
    // Nothing below it: dropped, the tier left empty.
    const last = { p0: "S", p1: "S", p2: "S", p3: "A" } as const;
    expect(sendableTiers(last, new Set(["p3"]), settled)).toEqual({ p0: "S", p1: "S", p2: "S" });
    // B-Tier only withdrawn ones: dropped; then A-Tier's withdrawn one has nothing below.
    expect(sendableTiers({ p0: "S", p3: "A", p5: "B" }, new Set(["p3", "p5"]), new Set()))
      .toEqual({ p0: "S" });
    // An open S-Tier of withdrawn ones above A-Tier picks stays too.
    expect(sendableTiers({ p0: "S", p4: "A" }, new Set(["p0"]), new Set())).toEqual({
      p0: "S",
      p4: "A",
    });
  });

  test("sendableTiers drops only the open tiers' withdrawn ones, and nothing else", () => {
    expect(sendableTiers(tiers, new Set(["p1", "p5"]), new Set<Tier>(["S"]))).toEqual({
      p0: "S",
      p1: "S",
      p2: "S",
      p3: "A",
      p4: "A",
    });
    expect(sendableTiers(tiers, new Set(), new Set())).toBe(tiers);
  });
});

describe("a fresh draft", () => {
  test("leaves every withdrawn initiative out, placeholders too: an emptied tier asks for a choice", () => {
    // Three 5★ projects, all withdrawn: no S-Tier of placeholders that funds nothing.
    const rated: Partial<Record<string, Tier>> = { a: "S", b: "S", c: "S", d: "A" };
    expect(freshDraft(rated, new Set(["a", "b", "c"]))).toEqual({ d: "A" });
    expect(sendableTiers(rated, new Set(["a", "b", "c"]), new Set())).toBe(rated);
    expect(freshDraft(rated, new Set())).toBe(rated);
  });
});

describe("sending preserves displayed tier labels", () => {
  test("an empty A-Tier cannot silently promote B-Tier", () => {
    expect(() => encodeBallotForSend(slugs, { a: "S", b: "B" })).toThrow("A-Tier must have a pick");
    expect(() => sendableBallot(slugs, { a: "S", b: "B" }, new Set(), new Set(["S", "A"]))).toThrow(
      "A-Tier",
    );
  });
  test("both empty intermediate tiers are refused", () => {
    expect(() => encodeBallotForSend(slugs, { d: "B" })).toThrow("S-Tier and A-Tier");
    expect(() => encodeBallotForSend(slugs, { unknown: "A", a: "S", d: "B" })).toThrow("A-Tier");
  });
  test("existing withdrawn placeholders preserve both intermediate tiers", () => {
    const sent = sendableBallot(slugs, { a: "S", b: "A", d: "B" }, new Set(["a", "b"]), new Set());
    expect(decodeBallot(sent, slugs)).toEqual({ a: "S", b: "A", d: "B" });
  });
});

test("shape agrees with full validation when amount and independence constraints are disabled", () => {
  for (let m = 1; m <= 4; m++) {
    const round = {
      projects: Array.from({ length: m }, () => ({ goalUsd: 1n, rfp: false, groups: [] })),
      asks: Array<bigint>(m).fill(1n),
      poolUsd: 0n,
      independentTiers: 0,
      groupNames: [],
    };
    const alphabet = [0, ...Array.from({ length: m }, (_, i) => i + 1), 255];
    const visit = (bytes: number[]) => {
      const ballot = Uint8Array.from(bytes);
      expect(isValidBallotShape(ballot, m), `${m}: ${bytes}`).toBe(checkBallot(ballot, round).ok);
      if (bytes.length < m) { for (const rank of alphabet) visit([...bytes, rank]); }
    };
    visit([]);
  }
});
