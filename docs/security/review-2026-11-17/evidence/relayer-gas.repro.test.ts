import { assert, assertEquals } from "@std/assert";
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
import { createVoteChain } from "../../../../api/services/vote-chain.ts";
import { harness } from "../../../../api/tests/app-helpers.ts";
import { SIGNED_BALLOTS_ABI } from "../../../../shared/vote/abi.ts";
import type { VoteManifest } from "../../../../shared/vote/manifest.ts";

// Real route and locked viem signer, synthetic RPC only. No network or real key.
Deno.test("NOV-01: public ballot relay signs an eight-million-gas contract-wallet transaction", async () => {
  const h = await harness();
  try {
    const now = h.clock.now;
    const owner = "0x5555555555555555555555555555555555555555";
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
    let sent: ReturnType<typeof parseTransaction> | undefined;
    const erc1271 = parseAbi(["function isValidSignature(bytes32,bytes) view returns (bytes4)"]);
    const transport = custom({
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        switch (method) {
          case "eth_chainId":
            return "0x1";
          case "eth_getCode":
            return "0x6000";
          case "eth_getBalance":
            return toHex(10n ** 18n);
          case "eth_getTransactionCount":
            return "0x0";
          case "eth_getBlockByNumber":
            return {
              number: "0x64",
              hash: zeroHash,
              parentHash: zeroHash,
              timestamp: toHex(now - 1),
              gasLimit: toHex(30_000_000),
              gasUsed: "0x0",
              baseFeePerGas: toHex(1_000_000_000),
              transactions: [],
              extraData: "0x",
            };
          case "eth_maxPriorityFeePerGas":
            return toHex(1_000_000_000);
          case "eth_gasPrice":
            return toHex(2_000_000_000);
          case "eth_estimateGas":
            return toHex(8_200_000);
          case "eth_sendRawTransaction":
            sent = parseTransaction(params[0] as Hex);
            return `0x${"ab".repeat(32)}`;
          case "eth_call": {
            const call = params[0] as { to: string; data: Hex };
            if (call.to.toLowerCase() === owner) {
              assertEquals(
                decodeFunctionData({ abi: erc1271, data: call.data }).functionName,
                "isValidSignature",
              );
              return encodeFunctionResult({
                abi: erc1271,
                functionName: "isValidSignature",
                result: "0x1626ba7e",
              });
            }
            const decoded = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: call.data });
            if (decoded.functionName === "ownerOf") {
              return encodeFunctionResult({
                abi: SIGNED_BALLOTS_ABI,
                functionName: "ownerOf",
                result: owner,
              });
            }
            if (decoded.functionName === "nonceOf") {
              return encodeFunctionResult({
                abi: SIGNED_BALLOTS_ABI,
                functionName: "nonceOf",
                result: 0n,
              });
            }
            throw new Error(`Unexpected call ${decoded.functionName}`);
          }
          default:
            throw new Error(`Unexpected RPC ${method}`);
        }
      },
    }, { retryCount: 0 });
    const chain = createVoteChain(
      manifest,
      "http://unused.invalid",
      `0x${"77".repeat(32)}`,
      transport,
    );
    h.deps.vote = {
      manifest,
      chain: {
        ...chain,
        ballots: async () => ({ events: [], block: 100n }),
        committed: async () => ({ transcript: zeroHash, recordCount: 0n, hashes: [] }),
        rulesHistory: async () => ({ addedAt: [], pool: [] }),
      },
      states: async () => [{
        block: 100,
        timestamp: now - 1,
        asks: [1_000_000n, 1_000_000n, 1_000_000n],
        poolUsd: 0n,
        poolInitialized: true,
        withdrawn: [],
        event: false,
      }],
    };
    const response = await h.req("/api/vote/ballot", {
      method: "POST",
      json: { tokenId: "1", nonce: "1", ballot: "0x010101", signature: "0x1234" },
    });
    const result = await response.json();
    assertEquals(response.status, 200, JSON.stringify(result));
    assert(sent);
    assertEquals(sent.gas, 8_200_000n);
    assertEquals(
      decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: sent.data! }).functionName,
      "recordFor",
    );
    console.log(
      JSON.stringify({
        status: response.status,
        gas: sent.gas!.toString(),
        maxFeePerGas: sent.maxFeePerGas?.toString(),
        method: "recordFor",
      }),
    );
  } finally {
    h.close();
  }
});
