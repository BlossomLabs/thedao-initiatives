import { describe, expect, it } from "vitest";
import { hashTypedData, keccak256, toHex } from "viem";
import type { VoteManifest } from "./manifest.ts";
import { pledgeChainId, pledgeTypedData } from "./typed-data.ts";

describe("pledgeTypedData", () => {
  it("hashes to the digest the Forge test pins (SignedPledges.t.sol test_SignedPledge_Digest)", () => {
    const m = {
      chainId: 31337,
      contract: "0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f",
    } as unknown as VoteManifest;
    const digest = hashTypedData(pledgeTypedData(m, {
      pledgeId: "0x0000000000000000000000000000000000000000000000000000000000000abc",
      initiativeId: 2n,
      currencyId: 1n,
      amount: 5_000_000n,
      nonce: 7n,
      deadline: 1_900_000_000n,
    }));
    expect(digest).toBe("0xa38e543043a73b990adad292ee97477ffd23066afbe77fe991c45606f90ccd4e");
  });

  it("derives the chain pledge id from the record id", () => {
    expect(pledgeChainId("abc")).toBe(keccak256(toHex("pledge:abc")));
  });
});
