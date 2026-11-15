import { describe, expect, it } from "vitest";
import { checkManifest } from "./manifest";
import {
  manifestFromChain,
  type RoundOnChain,
  slugsByAccount,
  testPlaceholder,
} from "./round-from-chain";

const C = "0x1000000000000000000000000000000000000001";
const ISSUER = "0xd30fb0ba65c696e271ffa2e8b80f8c74b9d0998b";
const SAFE = "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C";

const chain = (accounts: `0x${string}`[]): RoundOnChain => ({
  deployBlock: 12,
  schedule: { opensAt: 1000, firstTallyAt: [2000, 3000, 4000], initialWindow: 320, maxWindows: 4 },
  poolUsd: 913_244_000_000n,
  independentTiers: 1,
  initiatives: accounts.map((account, i) => ({
    account,
    rfp: i === 1,
    goalUsd: BigInt(i + 1) * 1_000_000n,
    groups: i === 0 ? 0b101n : 0n,
  })),
  groups: ["Argot", "EF", "Nethermind"],
  currencies: [{
    symbol: "USD",
    asset: "0x0000000000000000000000000000000000000000",
    usdFeed: "0x0000000000000000000000000000000000000000",
  }],
});

const board = [
  { slug: "with-safe", safeAddress: SAFE },
  { slug: "no-safe", safeAddress: "" },
  { slug: "unused", safeAddress: "" },
];

describe("manifestFromChain", () => {
  it("matches initiatives by Safe and by a test placeholder, as vote-deploy writes them", () => {
    const m = manifestFromChain(
      C,
      ISSUER,
      chain([SAFE, testPlaceholder("no-safe")]),
      slugsByAccount(board),
    );
    expect(checkManifest(m)).toBe(m);
    expect(m.kind).toBe("test");
    expect(m.chainId).toBe(11155111);
    expect(m.slugs).toEqual(["with-safe", "no-safe"]);
    expect(m.projects).toEqual([
      { goalUsd: "1000000", rfp: false, groups: [0, 2] },
      { goalUsd: "2000000", rfp: true, groups: [] },
    ]);
    expect(m.poolUsd).toBe("913244000000");
    // B-Tier's last window: 320 + 160 + 80 + 40 after its first tally.
    expect(m.closesAt).toBe(4600);
    expect(m.issuer).toBe("0xD30fb0bA65C696e271ffA2e8b80F8c74B9d0998B");
    expect(m.ballotRules).toBe(true);
  });

  it("names the initiatives the board has no account for", () => {
    const stray = "0x9000000000000000000000000000000000000009";
    expect(() => manifestFromChain(C, ISSUER, chain([SAFE, stray]), slugsByAccount(board)))
      .toThrow(`#1 (${stray})`);
  });

  it("refuses a round with no initiatives or one matched twice", () => {
    expect(() => manifestFromChain(C, ISSUER, chain([]), slugsByAccount(board))).toThrow(
      "no initiatives",
    );
    const twice = slugsByAccount([{ slug: "a", safeAddress: SAFE }, {
      slug: "a",
      safeAddress: "",
    }]);
    expect(() => manifestFromChain(C, ISSUER, chain([SAFE, testPlaceholder("a")]), twice))
      .toThrow("twice");
  });
});
