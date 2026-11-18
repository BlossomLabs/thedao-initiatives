import { describe, expect, it } from "vitest";
import {
  checkManifest,
  onBallotSlugs,
  roundDeployed,
  rulesRound,
  type VoteManifest,
  voterNft,
} from "./manifest";

const C = "0x1000000000000000000000000000000000000001";
const B = "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C";
const base: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: C,
  deployBlock: 1,
  opensAt: 0,
  closesAt: 1,

  schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
  poolUsd: "1",
  slugs: ["a"],
  projects: [{ goalUsd: "5", rfp: false, groups: [0] }],
  groups: ["Seal"],
  independentTiers: 1,
};

describe("round manifest", () => {
  it("on the ballot: the real round's slugs only; a test round or none is empty", () => {
    expect([...onBallotSlugs({ ...base, kind: "real", chainId: 1, badge: B, slugs: ["a", "b"] })])
      .toEqual(["a", "b"]);
    expect(onBallotSlugs({ ...base, slugs: ["a"] }).size).toBe(0);
    expect(onBallotSlugs(undefined).size).toBe(0);
  });
  it("a real round votes with the badge; a test round with its own NFT", () => {
    expect(voterNft({ ...base, kind: "real", chainId: 1, badge: B })).toBe(B);
    expect(voterNft(base)).toBe(C);
  });
  it("an all-zero contract means no round", () => {
    expect(roundDeployed({ ...base, contract: `0x${"0".repeat(40)}` })).toBe(false);
    expect(roundDeployed(base)).toBe(true);
  });
  it("a real round needs a badge; a test round runs on Sepolia", () => {
    expect(() => checkManifest({ ...base, kind: "real", chainId: 1 })).toThrow(/badge/);
    expect(() => checkManifest({ ...base, chainId: 1 })).toThrow(/Sepolia/);
    expect(() => checkManifest(base)).not.toThrow();
  });
  it("checkManifest refuses misaligned projects, tagged RFPs and unknown groups", () => {
    expect(() => checkManifest({ ...base, projects: [] })).toThrow(/projects/);
    expect(() => checkManifest({ ...base, projects: [{ goalUsd: "5", rfp: true, groups: [0] }] }))
      .toThrow(/RFP/);
    expect(() => checkManifest({ ...base, projects: [{ goalUsd: "5", rfp: false, groups: [1] }] }))
      .toThrow(/group/);
  });
  it("a real round needs its currencies and accounts", () => {
    const Z = "0x0000000000000000000000000000000000000000";
    const real: VoteManifest = {
      ...base,
      kind: "real",
      chainId: 1,
      badge: B,
      currencies: [{ symbol: "USD", asset: Z, usdFeed: Z }, {
        symbol: "ETH",
        asset: Z,
        usdFeed: B,
      }],
      accounts: [C],
    };
    expect(() => checkManifest(real)).not.toThrow();
    expect(() => checkManifest({ ...real, currencies: undefined })).toThrow(/currencies/);
    expect(() => checkManifest({ ...real, currencies: real.currencies!.slice(0, 1) })).toThrow(
      /currencies/,
    );
    expect(() => checkManifest({ ...real, accounts: undefined })).toThrow(/accounts/);
    expect(() => checkManifest({ ...real, accounts: [C, B] })).toThrow(/accounts/);
  });
  it("a round without currencies counts pledges only", () => {
    expect(base.currencies).toBeUndefined();
    expect(() => checkManifest(base)).not.toThrow();
  });
  it("rulesRound maps the manifest", () => {
    expect(rulesRound(base, [5n])).toEqual({
      projects: [{ goalUsd: 5n, rfp: false, groups: [0] }],
      asks: [5n],
      groupNames: ["Seal"],
      poolUsd: 1n,
      independentTiers: 1,
    });
    expect(rulesRound(base, [5n], 9n).poolUsd).toBe(9n);
  });
  it("rulesRound marks the withdrawn projects by index, for the size rule", () => {
    expect(rulesRound(base, [5n], undefined, [0]).withdrawn).toEqual([true]);
    expect(rulesRound(base, [5n], undefined, []).withdrawn).toEqual([false]);
    expect(rulesRound(base, [5n]).withdrawn).toBeUndefined();
  });
  it("rulesRound wants one ask per project", () => {
    expect(() => rulesRound(base, [])).toThrow(/0 asks for 1 projects/);
    expect(() => rulesRound(base, [5n, 6n])).toThrow(/asks/);
  });
  it("every round carries the contract's quiet-ending schedule", () => {
    expect(() => checkManifest({ ...base, schedule: undefined as never })).toThrow(/schedule/);
  });
  it("a test round never runs on mainnet (its badges and gas drip are free)", () => {
    expect(() => checkManifest({ ...base, chainId: 1 })).toThrow(/Sepolia/);
  });
});
