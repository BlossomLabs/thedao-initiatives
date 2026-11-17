import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  parseAbi,
  parseTransaction,
  toHex,
  zeroHash,
} from "viem";
import { createVoteChain, type VoteChain } from "../services/vote-chain.ts";
import {
  BALLOT_RELAY_COST,
  BALLOT_RELAY_FEE,
  BALLOT_RELAY_GAS,
  ballotRelayBudget,
  CONTRACT_SIGNATURE_GAS,
  RelayBudgetError,
} from "../services/vote-relay-policy.ts";
import { harness } from "./app-helpers.ts";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";

const owner = "0x5555555555555555555555555555555555555555";
const contractVote: Parameters<VoteChain["send"]>[0] = {
  fn: "recordFor",
  args: [1n, 1n, "0x010101", "0x1234", [0, 1, 2]],
};
const keyVote: Parameters<VoteChain["send"]>[0] = {
  fn: "record",
  args: [[{
    tokenId: 1n,
    nonce: 1n,
    ballot: "0x010101",
    r: zeroHash,
    vs: zeroHash,
    proof: [0, 1, 2],
  }]],
};

function rpc(now = 1_800_000_000) {
  const manifest: VoteManifest = {
    kind: "real",
    chainId: 1,
    contract: "0x1000000000000000000000000000000000000001",
    badge: "0x2000000000000000000000000000000000000002",
    deployBlock: 1,
    opensAt: now - 100,
    closesAt: now + 1000,
    schedule: {
      opensAt: now - 100,
      firstTallyAt: [now + 100, now + 200, now + 300],
      initialWindow: 60,
      maxWindows: 1,
    },
    poolUsd: "0",
    slugs: ["one", "two", "three"],
    projects: Array.from({ length: 3 }, () => ({ goalUsd: "1000000", rfp: false, groups: [] })),
    groups: [],
    independentTiers: 1,
    ballotRules: true,
  };
  const state = {
    estimate: 150_000n,
    baseFee: 1_000_000_000n,
    priorityFee: 1_000_000_000n,
    estimateError: false,
    signatureError: false,
    magic: "0x1626ba7e" as Hex,
    signatureGas: 0n,
    estimates: 0,
    sent: [] as ReturnType<typeof parseTransaction>[],
  };
  const erc1271 = parseAbi(["function isValidSignature(bytes32,bytes) view returns (bytes4)"]);
  const transport = custom({
    request: ({ method, params }: { method: string; params: unknown[] }) => {
      switch (method) {
        case "eth_chainId":
          return Promise.resolve("0x1");
        case "eth_getCode":
          return Promise.resolve("0x6000");
        case "eth_getBalance":
          return Promise.resolve(toHex(10n ** 18n));
        case "eth_getTransactionCount":
          return Promise.resolve("0x0");
        case "eth_getBlockByNumber":
          return Promise.resolve({
            number: "0x64",
            hash: zeroHash,
            parentHash: zeroHash,
            timestamp: toHex(now - 1),
            gasLimit: toHex(30_000_000),
            gasUsed: "0x0",
            baseFeePerGas: toHex(state.baseFee),
            transactions: [],
            extraData: "0x",
          });
        case "eth_maxPriorityFeePerGas":
          return Promise.resolve(toHex(state.priorityFee));
        case "eth_estimateGas": {
          state.estimates++;
          assertEquals(BigInt((params[0] as { gas: Hex }).gas), BALLOT_RELAY_GAS);
          if (state.estimateError) return Promise.reject(new Error("RPC estimate unavailable"));
          return Promise.resolve(toHex(state.estimate));
        }
        case "eth_sendRawTransaction":
          state.sent.push(parseTransaction(params[0] as Hex));
          return Promise.resolve(`0x${"ab".repeat(32)}`);
        case "eth_call": {
          const call = params[0] as { to: string; data: Hex; gas: Hex };
          if (call.to.toLowerCase() === owner) {
            state.signatureGas = BigInt(call.gas);
            assertEquals(
              decodeFunctionData({ abi: erc1271, data: call.data }).functionName,
              "isValidSignature",
            );
            if (state.signatureError) return Promise.reject(new Error("out of gas"));
            return Promise.resolve(
              encodeFunctionResult({
                abi: erc1271,
                functionName: "isValidSignature",
                result: state.magic,
              }),
            );
          }
          const decoded = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: call.data });
          if (decoded.functionName === "ownerOf") {
            return Promise.resolve(
              encodeFunctionResult({
                abi: SIGNED_BALLOTS_ABI,
                functionName: "ownerOf",
                result: owner,
              }),
            );
          }
          if (decoded.functionName === "nonceOf") {
            return Promise.resolve(
              encodeFunctionResult({
                abi: SIGNED_BALLOTS_ABI,
                functionName: "nonceOf",
                result: 0n,
              }),
            );
          }
          throw new Error(`Unexpected call ${decoded.functionName}`);
        }
        default:
          throw new Error(`Unexpected RPC ${method}`);
      }
    },
  }, { retryCount: 0 });
  // Public fixture key; no RPC or transaction leaves this in-memory transport.
  return {
    manifest,
    state,
    chain: createVoteChain(manifest, "http://unused.invalid", `0x${"77".repeat(32)}`, transport),
  };
}

Deno.test("ballot sponsorship pins gas and both fees in the actual signed transaction for both entry points", async () => {
  for (const call of [keyVote, contractVote]) {
    const { chain, state } = rpc();
    await chain.send(call, 7);
    assertEquals(state.estimates, 1, "the wallet must not estimate a second time");
    assertEquals(state.sent.length, 1);
    const tx = state.sent[0];
    assertEquals(tx.nonce, 7);
    assertEquals(tx.gas, 180_000n);
    assertEquals(tx.maxFeePerGas, 2_200_000_000n);
    assertEquals(tx.maxPriorityFeePerGas, 1_000_000_000n);
    assert(tx.gas! * tx.maxFeePerGas! <= BALLOT_RELAY_COST);
    assertEquals(
      decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: tx.data! }).functionName,
      call.fn,
    );
  }
});

Deno.test("ballot sponsorship rejects costly estimates, costly fees, costly totals and estimate failures without signing", async () => {
  for (
    const patch of [
      { estimate: 8_200_000n },
      { baseFee: BALLOT_RELAY_FEE },
      { estimate: 3_000_000n },
      { estimateError: true },
    ]
  ) {
    const { chain, state } = rpc();
    Object.assign(state, patch);
    await assertRejects(() => chain.send(contractVote, 0));
    assertEquals(state.sent.length, 0);
  }
});

Deno.test("the large-ballot gas envelope remains sponsorable at affordable fees", async () => {
  const { chain, state } = rpc();
  Object.assign(state, { estimate: 3_000_000n, baseFee: 100_000_000n, priorityFee: 100_000_000n });
  await chain.send(contractVote, 0);
  assertEquals(state.sent[0].gas, 3_600_000n);
  assert(state.sent[0].gas! * state.sent[0].maxFeePerGas! <= BALLOT_RELAY_COST);
});

Deno.test("ballot sponsorship caps padding and refuses malformed fee quotes", () => {
  assertEquals(
    ballotRelayBudget(BALLOT_RELAY_GAS, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }).gas,
    BALLOT_RELAY_GAS,
  );
  for (const [gas, fee, tip] of [[0n, 1n, 1n], [1n, 0n, 0n], [1n, 1n, 2n], [1n, 1n, -1n]]) {
    let rejected = false;
    try {
      ballotRelayBudget(gas, { maxFeePerGas: fee, maxPriorityFeePerGas: tip });
    } catch (e) {
      rejected = e instanceof RelayBudgetError;
    }
    assert(rejected);
  }
});

Deno.test("ERC-1271 preflight has a fixed gas budget and preserves wrong-magic rejection", async () => {
  const { chain, state } = rpc();
  assertEquals(await chain.verifyContractVote(owner, 1n, 1n, "0x010101", "0x1234"), true);
  assertEquals(state.signatureGas, CONTRACT_SIGNATURE_GAS);
  state.magic = "0xffffffff";
  assertEquals(await chain.verifyContractVote(owner, 1n, 1n, "0x010101", "0x1234"), false);
  state.signatureError = true;
  await assertRejects(
    () => chain.verifyContractVote(owner, 1n, 1n, "0x010101", "0x1234"),
    RelayBudgetError,
  );
  assertEquals(state.sent.length, 0);
});

Deno.test("public ballot relay offers self-send for an expensive owner without consuming the badge's relay quota", async () => {
  const h = await harness();
  try {
    const { manifest, chain, state } = rpc(h.clock.now);
    h.deps.vote = {
      manifest,
      chain: {
        ...chain,
        ballots: () => Promise.resolve({ events: [], block: 100n }),
        committed: () => Promise.resolve({ transcript: zeroHash, recordCount: 0n, hashes: [] }),
        rulesHistory: () => Promise.resolve({ addedAt: [], pool: [] }),
      },
      states: () =>
        Promise.resolve([{
          block: 100,
          timestamp: h.clock.now - 1,
          asks: [1_000_000n, 1_000_000n, 1_000_000n],
          poolUsd: 0n,
          poolInitialized: true,
          withdrawn: [],
          event: false,
        }]),
    };
    const submit = () =>
      h.req("/api/vote/ballot", {
        method: "POST",
        json: { tokenId: "1", nonce: "1", ballot: "0x010101", signature: "0x1234" },
      });
    state.estimate = 8_200_000n;
    const expensive = await submit();
    assertEquals(expensive.status, 503);
    assertEquals((await expensive.json()).code, "relay_budget");
    assertEquals(state.sent.length, 0);
    state.signatureError = true;
    const preflight = await submit();
    assertEquals(preflight.status, 503);
    assertEquals((await preflight.json()).code, "relay_budget");
    state.signatureError = false;
    state.estimate = 150_000n;
    assertEquals((await submit()).status, 200);
    assertEquals(state.sent.length, 1);
  } finally {
    h.close();
  }
});
