import { describe, expect, it } from "vitest";
import type { VoteManifest } from "./manifest.ts";
import { testDonation } from "./test-usd.ts";

const TOKEN = "0x3000000000000000000000000000000000000003";
const A = "0x1000000000000000000000000000000000000001";
const B = "0x2000000000000000000000000000000000000002";
const base = {
  kind: "test",
  slugs: ["a", "b"],
  accounts: [A, B],
  currencies: [
    {
      symbol: "USD",
      asset: "0x0000000000000000000000000000000000000000",
      usdFeed: "0x0000000000000000000000000000000000000000",
    },
    { symbol: "tUSD", asset: TOKEN, usdFeed: "0x0000000000000000000000000000000000000000" },
  ],
} as unknown as VoteManifest;

describe("testDonation", () => {
  it("names the test dollar and the initiative's own account", () => {
    expect(testDonation(base, "b")).toEqual({ token: TOKEN, account: B });
  });
  it("is null for a real round, an unknown slug or a round without a test dollar", () => {
    expect(testDonation({ ...base, kind: "real" }, "a")).toBeNull();
    expect(testDonation(base, "zz")).toBeNull();
    expect(testDonation({ ...base, currencies: base.currencies!.slice(0, 1) }, "a")).toBeNull();
  });
});
