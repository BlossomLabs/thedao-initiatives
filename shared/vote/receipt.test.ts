import { describe, expect, test } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Hex } from "viem";
import { SIGNED_BALLOTS_ABI } from "./abi.ts";
import { checkBallotTx } from "./receipt.ts";
import type { VoteManifest } from "./manifest.ts";

const m: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: 1_000,
  closesAt: 2_000,

  schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
  poolUsd: "913244000000",
  slugs: ["a", "b"],
  projects: [{ goalUsd: "1", rfp: false, groups: [] }, { goalUsd: "1", rfp: false, groups: [] }],
  groups: [],
  independentTiers: 1,
};
const ballot: Hex = "0x01ff";
const sig: Hex = `0x${"11".repeat(65)}`;
const recordFor = (tokenId: bigint, nonce: bigint, b: Hex) =>
  encodeFunctionData({
    abi: SIGNED_BALLOTS_ABI,
    functionName: "recordFor",
    args: [tokenId, nonce, b, sig, [0, 1, 2]],
  });
const expectOk = { tokenId: 7n, nonce: 2n, ballot };
const base = {
  m,
  tx: { to: m.contract as string | null, input: recordFor(7n, 2n, ballot) },
  status: "success" as const,
  blockTimestamp: 1_500,
  expect: expectOk,
};

describe("checkBallotTx", () => {
  test("counted: our contract, recordFor, same token, nonce and bytes, before close", () => {
    expect(checkBallotTx(base)).toBe("counted");
  });

  test("counted for a self-sent vote() too", () => {
    const input = encodeFunctionData({
      abi: SIGNED_BALLOTS_ABI,
      functionName: "vote",
      args: [7n, 2n, ballot, [0, 1, 2]],
    });
    expect(checkBallotTx({ ...base, tx: { to: m.contract, input } })).toBe("counted");
  });

  test("the contract address compares without case", () => {
    expect(checkBallotTx({ ...base, tx: { ...base.tx, to: m.contract.toUpperCase() } }))
      .toBe("counted");
  });

  test("late: mined at the close", () => {
    expect(checkBallotTx({ ...base, blockTimestamp: 2_000 })).toBe("late");
  });

  test("reverted", () => {
    expect(checkBallotTx({ ...base, status: "reverted" })).toBe("reverted");
  });

  test("mismatch: other contract, token, nonce, ballot, function or garbage", () => {
    const other = (patch: Partial<typeof base>) => checkBallotTx({ ...base, ...patch });
    expect(
      other({ tx: { to: "0x3000000000000000000000000000000000000003", input: base.tx.input } }),
    )
      .toBe("mismatch");
    expect(other({ tx: { to: null, input: base.tx.input } })).toBe("mismatch");
    expect(other({ tx: { to: m.contract, input: recordFor(8n, 2n, ballot) } })).toBe("mismatch");
    expect(other({ tx: { to: m.contract, input: recordFor(7n, 3n, ballot) } })).toBe("mismatch");
    expect(other({ tx: { to: m.contract, input: recordFor(7n, 2n, "0x0101") } })).toBe("mismatch");
    const mint = encodeFunctionData({
      abi: SIGNED_BALLOTS_ABI,
      functionName: "mint",
      args: [m.contract, 7n],
    });
    expect(other({ tx: { to: m.contract, input: mint } })).toBe("mismatch");
    expect(other({ tx: { to: m.contract, input: "0xdeadbeef" } })).toBe("mismatch");
  });

  test("counted for record() (the relay's ECDSA path that 7702 wallets need)", () => {
    const record = (tokenId: bigint, nonce: bigint, b: Hex) =>
      encodeFunctionData({
        abi: SIGNED_BALLOTS_ABI,
        functionName: "record",
        args: [[{
          tokenId,
          nonce,
          r: `0x${"11".repeat(32)}`,
          vs: `0x${"22".repeat(32)}`,
          ballot: b,
          proof: [0, 1, 2],
        }]],
      });
    expect(checkBallotTx({ ...base, tx: { to: m.contract, input: record(7n, 2n, ballot) } }))
      .toBe("counted");
    expect(checkBallotTx({ ...base, tx: { to: m.contract, input: record(7n, 3n, ballot) } }))
      .toBe("mismatch");
    expect(checkBallotTx({ ...base, tx: { to: m.contract, input: record(8n, 2n, ballot) } }))
      .toBe("mismatch");
  });
});

test("a Safe wrapper must emit the matching round record, even when the outer call succeeds", () => {
  const log = {
    address: m.contract,
    topics: encodeEventTopics({
      abi: SIGNED_BALLOTS_ABI,
      eventName: "BallotRecorded",
      args: { tokenId: 7n, voter: m.contract },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint64" }, { type: "bytes" }], [2n, ballot]),
  };
  const wrapped = {
    ...base,
    tx: { to: "0x3000000000000000000000000000000000000003", input: "0xdeadbeef" as const },
  };
  expect(checkBallotTx({ ...wrapped, logs: [log] })).toBe("counted");
  expect(checkBallotTx({ ...wrapped, logs: [] })).toBe("mismatch");
  expect(checkBallotTx({ ...wrapped, logs: [{ ...log, address: wrapped.tx.to }] })).toBe(
    "mismatch",
  );
  expect(checkBallotTx({ ...wrapped, logs: [log], expect: { ...expectOk, nonce: 3n } })).toBe(
    "mismatch",
  );
});
