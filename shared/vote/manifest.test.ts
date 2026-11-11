import { describe, expect, it } from "vitest";
import { checkManifest, roundDeployed, rulesRound, type VoteManifest, voterNft } from "./manifest";

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
  issuer: "0x2000000000000000000000000000000000000002",
  slugs: ["a"],
  projects: [{ askUsd: "5", rfp: false, groups: [0] }],
  groups: ["Seal"],
  independentTiers: 1,
};

describe("round manifest", () => {
  it("a real round votes with the badge; a test round with its own NFT", () => {
    expect(voterNft({ ...base, kind: "real", chainId: 1, issuer: undefined, badge: B })).toBe(B);
    expect(voterNft(base)).toBe(C);
  });
  it("an all-zero contract means no round", () => {
    expect(roundDeployed({ ...base, contract: `0x${"0".repeat(40)}` })).toBe(false);
    expect(roundDeployed(base)).toBe(true);
  });
  it("a real round needs a badge; a test round needs an issuer", () => {
    expect(() => checkManifest({ ...base, kind: "real", chainId: 1, issuer: undefined })).toThrow(
      /badge/,
    );
    expect(() => checkManifest({ ...base, issuer: undefined })).toThrow(/issuer/);
    expect(() => checkManifest(base)).not.toThrow();
  });
  it("checkManifest refuses misaligned projects, tagged RFPs and unknown groups", () => {
    expect(() => checkManifest({ ...base, projects: [] })).toThrow(/projects/);
    expect(() => checkManifest({ ...base, projects: [{ askUsd: "5", rfp: true, groups: [0] }] }))
      .toThrow(/RFP/);
    expect(() => checkManifest({ ...base, projects: [{ askUsd: "5", rfp: false, groups: [1] }] }))
      .toThrow(/group/);
  });
  it("rulesRound maps the manifest", () => {
    expect(rulesRound(base)).toEqual({
      projects: [{ askUsd: 5n, rfp: false, groups: [0] }],
      groupNames: ["Seal"],
      poolUsd: 1n,
      independentTiers: 1,
    });
    expect(rulesRound(base, 9n).poolUsd).toBe(9n);
  });
  it("every round carries the contract's quiet-ending schedule", () => {
    expect(() => checkManifest({ ...base, schedule: undefined as never })).toThrow(/schedule/);
  });
  it("a test round never runs on mainnet (its badges and gas drip are free)", () => {
    expect(() => checkManifest({ ...base, chainId: 1 })).toThrow(/Sepolia/);
  });
});
