import { expect, it } from "vitest";
import { newSinceSent } from "./vote-new";

const slugs = ["a", "b", "c", "d"];
const view = (sent: Record<string, number> | undefined, withdrawn: string[] = []) => ({
  acceptedLengths: sent,
  live: { withdrawn } as never,
});

it("counts the initiatives after the sent ballot's end, withdrawn ones aside", () => {
  expect(newSinceSent(view({ "1": 2 }), slugs, 1)).toBe(2);
  expect(newSinceSent(view({ "1": 2 }, ["d"]), slugs, 1)).toBe(1);
  expect(newSinceSent(view({ "1": 4 }), slugs, 1)).toBe(0);
});

it("none before a first send, or from a round that doesn't say", () => {
  expect(newSinceSent(view({ "2": 1 }), slugs, 1)).toBe(0);
  expect(newSinceSent(view(undefined), slugs, 1)).toBe(0);
  expect(newSinceSent(undefined, slugs, 1)).toBe(0);
});
