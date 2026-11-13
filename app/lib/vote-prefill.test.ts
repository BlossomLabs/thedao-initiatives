import { expect, it } from "vitest";
import { prefillFromRatings, ratingsToken, skipsFromRatings } from "./vote-prefill";

it("5★ S-Tier, 4★ A-Tier, 3★ B-Tier; 1–2★, unrated and outside the round left out", () => {
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

it("1–2★ are skipped, in round order; nothing else is", () => {
  expect(skipsFromRatings({ a: 5, b: 2, c: 3, d: 1, e: 4, outside: 1 }, ["e", "d", "c", "b", "a"]))
    .toEqual(["d", "b"]);
});
