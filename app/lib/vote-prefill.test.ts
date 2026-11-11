import { expect, it } from "vitest";
import { prefillFromRatings, ratingsToken } from "./vote-prefill";

it("5★ Tier-S, 4★ Tier-A, 3★ Tier-B; 1–2★, unrated and outside the round left out", () => {
  expect(
    prefillFromRatings({ a: 5, b: 4, c: 3, d: 2, e: 1, outside: 5 }, [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]),
  ).toEqual({ a: "S", b: "A", c: "B" });
});

it("whose ratings: the voting badge itself in the real vote; the reviewer's lowest badge in a test", () => {
  expect(ratingsToken("real", 42, ["7"])).toBe("42");
  expect(ratingsToken("test", 17, ["9", "5", "12"])).toBe("5");
  expect(ratingsToken("test", 17, [])).toBeNull();
  expect(ratingsToken("test", 17, undefined)).toBeNull();
});
