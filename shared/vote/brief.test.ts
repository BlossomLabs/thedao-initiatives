import { describe, expect, it } from "vitest";
import { cleanBriefText, ofGoal, paidOnAdoption } from "./brief";

describe("vote brief", () => {
  it("paid on adoption: the adoption milestones' share of the goal", () => {
    expect(paidOnAdoption({ adoptionUsd: 125_000, goalUsd: 370_000 }))
      .toBe("34% ($125,000 of $370,000)");
    expect(paidOnAdoption({ adoptionUsd: 0, goalUsd: 370_000 }))
      .toBe("none: no milestone is flagged adoption");
  });

  it("puts the ask beside the goal", () => {
    expect(ofGoal(277_500, 370_000)).toBe("75% of goal");
    expect(ofGoal(5_000, 0)).toBe("");
  });

  it("takes the model's lists, stripping bullet marks, labels and bold", () => {
    expect(cleanBriefText({
      what: [
        { title: "**Verified EVM:**", text: "- Prove the EVM correct." },
        { title: "Proof manifests", text: "Publish what is shared." },
      ],
      adoption: ["**Adoption:** 3 wallets", "or 2 clients"],
    })).toEqual({
      what: [
        { title: "Verified EVM", text: "Prove the EVM correct." },
        { title: "Proof manifests", text: "Publish what is shared." },
      ],
      adoption: ["3 wallets", "or 2 clients"],
    });
    // A lone adoption string is one bullet.
    expect(cleanBriefText({ what: [{ title: "X", text: "Builds X." }], adoption: "3 wallets." }))
      .toEqual({ what: [{ title: "X", text: "Builds X." }], adoption: ["3 wallets."] });
  });

  it("refuses a reply it can't use", () => {
    const w = [{ title: "X", text: "Builds X." }];
    expect(cleanBriefText({ what: w })).toBeNull();
    expect(cleanBriefText({ what: [], adoption: ["y"] })).toBeNull();
    expect(cleanBriefText({ what: ["Builds X."], adoption: ["y"] })).toBeNull();
    expect(cleanBriefText({ what: [{ title: "", text: "a" }], adoption: ["y"] })).toBeNull();
    expect(
      cleanBriefText({
        what: [{ title: "one two three four five six", text: "a" }],
        adoption: ["y"],
      }),
    )
      .toBeNull();
    expect(cleanBriefText({ what: Array(4).fill(w[0]), adoption: ["y"] })).toBeNull();
    expect(cleanBriefText({ what: w, adoption: ["a", "b", "c", "d"] })).toBeNull();
    expect(cleanBriefText({ what: w, adoption: ["a", "b", "c"] })).not.toBeNull();
    expect(cleanBriefText({ what: w, adoption: ["x".repeat(301)] })).toBeNull();
  });
});
