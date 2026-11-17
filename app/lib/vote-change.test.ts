import { describe, expect, it } from "vitest";
import { changeCause, changeEffect, changeMoves } from "./vote-change";
import type { LastChangeJson } from "../../shared/vote/replay-round";

const title = (slug: string) => slug.toUpperCase();
const change = (over: Partial<LastChangeJson>): LastChangeJson => ({
  at: 0,
  causes: [],
  moved: [],
  amounts: [],
  ...over,
});

describe("last change copy", () => {
  it("says a revised ballot and what it moved", () => {
    const c = change({
      causes: [{ kind: "ballot", tokenId: "7", first: false }],
      moved: [{ slug: "foo", from: "S", to: null }, { slug: "bar", from: "A", to: "S" }],
      amounts: ["baz"],
    });
    expect(changeCause(c, title)).toBe("a voter changed their ballot");
    expect(changeEffect(c)).toBe("moved 2 initiatives and changed 1 amount");
    expect(changeMoves(c, title)).toBe("FOO: S-Tier → not funded\nBAR: A-Tier → S-Tier");
  });

  it("groups ballots and names donations, the pool and settlements", () => {
    const c = change({
      causes: [
        { kind: "ballot", tokenId: "1", first: true },
        { kind: "ballot", tokenId: "2", first: true },
        { kind: "ask", slug: "foo", from: "150000000", to: "100000000" },
        { kind: "ask", slug: "bar", from: "0", to: "100000000" },
        { kind: "pool", from: "1", to: "900000000000" },
        { kind: "settled", tier: "S" },
      ],
    });
    expect(changeCause(c, title)).toBe(
      "2 new voters sent ballots, a donation to FOO, BAR joined the vote, the pool changed to $900k and S-Tier settled",
    );
  });
});
