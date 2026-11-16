/** Reading a Sepolia test round from its contract, for Admin → Vote. */
import { assertEquals, assertRejects } from "@std/assert";
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  type Hex,
  multicall3Abi,
  stringToHex,
  toHex,
} from "viem";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import { readRoundOnChain } from "../services/vote-round-read.ts";

const ROUND: Hex = "0x1000000000000000000000000000000000000001";
const TUSD: Hex = "0x2000000000000000000000000000000000000002";
const ZERO: Hex = "0x0000000000000000000000000000000000000000";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const RELAYER: Hex = "0x3000000000000000000000000000000000000003";
const DEPLOYED = 70;

const answers: Record<string, (args: readonly unknown[]) => unknown> = {
  initiativeCount: () => 2n,
  currencyCount: () => 2n,
  groupCount: () => 1n,
  opensAt: () => 1000n,
  initialWindow: () => 320n,
  maxWindows: () => 4,
  firstTallyAt: ([t]) => [2000n, 3000n, 4000n][Number(t)],
  poolUsd: () => 913_244_000_000n,
  independentTiers: () => 1,
  initiative: ([i]) => ({
    account: i === 0n
      ? "0x4000000000000000000000000000000000000004"
      : "0x5000000000000000000000000000000000000005",
    rfp: i === 1n,
    goalUsd: 1_000_000n,
    groups: i === 0n ? 1n : 0n,
  }),
  groupName: () => stringToHex("Argot", { size: 32 }),
  currency: ([i]) => ({
    asset: i === 0n ? ZERO : TUSD,
    usdFeed: ZERO,
    amountDecimals: 6,
    feedDecimals: 0,
  }),
  MINTER_ROLE: () => toHex(7, { size: 32 }),
  eligibilityNFT: () => ROUND,
  hasRole: ([, a]) => (a as string).toLowerCase() === RELAYER,
};

function call(to: string, data: Hex): Hex {
  if (to.toLowerCase() === TUSD) {
    return encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: "tUSD" });
  }
  if (to.toLowerCase() !== ROUND) throw new Error("no contract");
  const { functionName, args } = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data });
  const answer = answers[functionName];
  if (!answer) throw new Error("unexpected " + functionName);
  return encodeFunctionResult({
    abi: SIGNED_BALLOTS_ABI,
    functionName,
    result: answer(args ?? []),
  } as never) as Hex;
}

const node = (o: { code?: boolean } = {}) =>
  custom({
    request: ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_chainId") return Promise.resolve(toHex(11155111));
      if (method === "eth_blockNumber") return Promise.resolve(toHex(100));
      if (method === "eth_getCode") {
        const at = params[1] === "latest" ? 100 : Number(params[1]);
        return Promise.resolve(o.code !== false && at >= DEPLOYED ? "0x6000" : "0x");
      }
      if (method === "eth_call") {
        const { to, data } = params[0] as { to: string; data: Hex };
        if (to.toLowerCase() !== MULTICALL3) return Promise.resolve(call(to, data));
        const [subs] = decodeFunctionData({ abi: multicall3Abi, data }).args as unknown as [
          { target: Hex; callData: Hex }[],
        ];
        const results = subs.map((s) => {
          try {
            return { success: true, returnData: call(s.target, s.callData) };
          } catch {
            return { success: false, returnData: "0x" as Hex };
          }
        });
        return Promise.resolve(
          encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results }),
        );
      }
      return Promise.reject(new Error("unexpected " + method));
    },
  });

Deno.test("readRoundOnChain: dates, pool, initiatives, affiliations, currencies and the deploy block", async () => {
  const r = await readRoundOnChain(ROUND, "http://node.test", node());
  assertEquals(r.deployBlock, DEPLOYED);
  assertEquals([r.chainId, r.eligibilityNFT.toLowerCase()], [11155111, ROUND]);
  assertEquals(r.schedule, {
    opensAt: 1000,
    firstTallyAt: [2000, 3000, 4000],
    initialWindow: 320,
    maxWindows: 4,
  });
  assertEquals(r.poolUsd, 913_244_000_000n);
  assertEquals(r.groups, ["Argot"]);
  assertEquals(r.initiatives.map((x) => [x.rfp, x.groups]), [[false, 1n], [true, 0n]]);
  assertEquals(r.currencies.map((c) => c.symbol), ["USD", "tUSD"]);
  assertEquals(await r.minters(RELAYER), true);
  assertEquals(await r.minters(ZERO), false);
});

Deno.test("readRoundOnChain: an address with no contract is said so", async () => {
  await assertRejects(
    () =>
      readRoundOnChain("0x9000000000000000000000000000000000000009", "http://node.test", node()),
    Error,
    "isn't a vote round",
  );
});
