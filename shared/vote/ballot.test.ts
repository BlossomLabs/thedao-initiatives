import { describe, expect, test } from "vitest";
import { decodeBallot, encodeBallot, isValidOnchainBallot, type Tier } from "./ballot.ts";

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
      expect(isValidOnchainBallot(b, 4)).toBe(true);
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

  test("on-chain validity matches SignedBallots._validateBallot", () => {
    expect(isValidOnchainBallot(Uint8Array.from([1, 1, 3, 255]), 4)).toBe(true);
    expect(isValidOnchainBallot(Uint8Array.from([255, 255, 255, 255]), 4)).toBe(true);
    expect(isValidOnchainBallot(Uint8Array.from([0, 255, 255, 255]), 4)).toBe(false);
    expect(isValidOnchainBallot(Uint8Array.from([2, 255, 255, 255]), 4)).toBe(false);
    expect(isValidOnchainBallot(Uint8Array.from([1, 1, 2, 255]), 4)).toBe(false);
    expect(isValidOnchainBallot(Uint8Array.from([5, 1, 1, 1]), 4)).toBe(false);
    expect(isValidOnchainBallot(Uint8Array.from([1, 255, 255]), 4)).toBe(false);
  });
});
