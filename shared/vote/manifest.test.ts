import { describe, expect, it } from "vitest";
import { checkManifest, roundDeployed, type VoteManifest, voterNft } from "./manifest";

const C = "0x1000000000000000000000000000000000000001";
const B = "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C";
const base: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: C,
  deployBlock: 1,
  opensAt: 0,
  closesAt: 1,
  poolUsd: "1",
  issuer: "0x2000000000000000000000000000000000000002",
  slugs: ["a"],
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
  it("a test round never runs on mainnet (its badges and gas drip are free)", () => {
    expect(() => checkManifest({ ...base, chainId: 1 })).toThrow(/Sepolia/);
  });
});
