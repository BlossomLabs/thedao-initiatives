import { expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, serializeSignature } from "viem";
import { recordVote } from "./record.ts";
import { voteTypedData } from "./typed-data.ts";
import type { VoteManifest } from "./manifest.ts";

const m: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: 0,
  closesAt: 2_000_000_000,

  schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
  poolUsd: "1",
  issuer: "0x2000000000000000000000000000000000000002",
  slugs: ["a", "b"],
};

test("recordVote splits the signature into r and vs that still recover the voter", async () => {
  const voter = privateKeyToAccount(`0x${"42".repeat(32)}`);
  const typed = voteTypedData(m, 7n, voter.address, 2n, "0x01ff");
  const signature = await voter.signTypedData(typed);
  const v = recordVote({ tokenId: 7n, nonce: 2n, ballot: "0x01ff", signature });
  expect([v.tokenId, v.nonce, v.ballot]).toEqual([7n, 2n, "0x01ff"]);
  // Re-expand the compact form and recover: it must be the voter (what ECDSA.tryRecover(r, vs) does).
  const yParity = BigInt(v.vs) >> 255n;
  const s = BigInt(v.vs) & ((1n << 255n) - 1n);
  const full = serializeSignature({
    r: v.r,
    s: `0x${s.toString(16).padStart(64, "0")}`,
    yParity: Number(yParity),
  });
  expect(await recoverTypedDataAddress({ ...typed, signature: full })).toBe(voter.address);
});
