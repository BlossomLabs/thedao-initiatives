import { describe, expect, it } from "vitest";
import { usd } from "~/lib/format";
import type { VoteManifest } from "../../../shared/vote/manifest";
import { poolEstimated, poolName, poolNoteText } from "./pool";

const R = {
  kind: "real",
  schedule: { opensAt: 0, firstTallyAt: [1_795_000_000, 0, 0], initialWindow: 1, maxWindows: 1 },
} as unknown as VoteManifest;

describe("the pool's copy", () => {
  it("is the dollars only without an ETH note", () => {
    expect(poolEstimated(R)).toBe(false);
    expect(poolName(R, 913_244)).toBe("$913k pool");
    expect(poolNoteText(R)).toBeNull();
  });

  it("is the ETH, its dollars an estimate, until sold", () => {
    const eth = { ...R, pool: { eth: 400, sold: false } };
    expect(poolName(eth, 913_244)).toBe("400 ETH pool (about $913k)");
    expect(poolName({ ...eth, kind: "test" }, 913_244, usd)).toBe(
      "400 ETH demo pool (about $913,244)",
    );
    expect(poolNoteText(eth)).toMatch(
      /^The pool is 400 ETH, sold for dollars before the S-Tier first tally \(\w{3} \d{1,2}, \d{2}:\d{2}\)\./,
    );
  });

  it("is the dollars again once sold", () => {
    const sold = { ...R, pool: { eth: 400, sold: true } };
    expect(poolEstimated(sold)).toBe(false);
    expect(poolName(sold, 1_200_000)).toBe("$1.2M pool");
    expect(poolNoteText(sold)).toBeNull();
  });
});
