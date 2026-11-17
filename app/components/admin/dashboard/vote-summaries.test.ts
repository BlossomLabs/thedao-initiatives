import { describe, expect, it } from "vitest";
import { type SummaryProgress, writeSummaries } from "./vote-summaries";

describe("writeSummaries", () => {
  it("asks for each id, at most 3 at a time, and reports after each", async () => {
    let inFlight = 0;
    let most = 0;
    const seen: SummaryProgress[] = [];
    const out = await writeSummaries(
      ["a", "b", "c", "d", "e"],
      async (id) => {
        most = Math.max(most, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        if (id === "c") throw new Error("today's AI call cap is reached");
      },
      (p) => seen.push(p),
    );
    expect(most).toBe(3);
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out).toEqual({
      done: 5,
      total: 5,
      failed: [{ id: "c", error: "today's AI call cap is reached" }],
    });
  });

  it("stops taking new ids once the page has gone", async () => {
    const asked: string[] = [];
    let gone = false;
    await writeSummaries(
      ["a", "b", "c", "d", "e"],
      (id) => {
        asked.push(id);
        gone = true;
        return Promise.resolve();
      },
      () => {},
      () => gone,
      1,
    );
    expect(asked).toEqual(["a"]);
  });
});
