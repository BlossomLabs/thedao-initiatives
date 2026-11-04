/** Many read calls in one eth_call through Multicall3 (the same address on
 * mainnet and every major chain: https://www.multicall3.com). viem does the ABI
 * work; the call itself goes through our RPC, so endpoint failover still applies. */
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  multicall3Abi,
} from "viem";
import { ethCall, type Rpc } from "./rpc.ts";

export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Sub-calls per eth_call: ~300 balance reads stay far below node gas and
 * payload caps (dRPC and publicnode cap eth_call at tens of millions of gas). */
export const MULTICALL_CHUNK = 300;

export interface Call {
  target: Address;
  callData: Hex;
}

/** A sub-call's outcome: `ok` false when it reverted. */
export interface CallResult {
  ok: boolean;
  data: Hex;
}

/** balanceOf(holder) on an ERC-20, or Multicall3's getEthBalance for native ETH,
 * so both ride in the same batch. */
export const balanceCall = (token: Address | "native", holder: Address): Call =>
  token === "native"
    ? {
      target: MULTICALL3,
      callData: encodeFunctionData({
        abi: multicall3Abi,
        functionName: "getEthBalance",
        args: [holder],
      }),
    }
    : {
      target: token,
      callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    };

/** Every call's result, in order; chunks run in parallel. A failed chunk
 * (the RPC itself, not a reverted sub-call) rejects the whole read. */
export async function multicall(rpc: Rpc, calls: Call[]): Promise<CallResult[]> {
  const chunks: Call[][] = [];
  for (let i = 0; i < calls.length; i += MULTICALL_CHUNK) {
    chunks.push(calls.slice(i, i + MULTICALL_CHUNK));
  }
  const out = await Promise.all(chunks.map(async (chunk) => {
    const data = encodeFunctionData({
      abi: multicall3Abi,
      functionName: "aggregate3",
      args: [chunk.map((c) => ({ ...c, allowFailure: true }))],
    });
    const results = decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      data: String(await ethCall(rpc, MULTICALL3, data)) as Hex,
    });
    if (results.length !== chunk.length) throw new Error("multicall: result count mismatch");
    return results.map((r) => ({ ok: r.success, data: r.returnData }));
  }));
  return out.flat();
}
