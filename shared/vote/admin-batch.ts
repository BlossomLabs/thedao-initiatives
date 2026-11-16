import { encodeFunctionData } from "viem";
import { SIGNED_BALLOTS_ABI } from "./abi.ts";
import type { VoteManifest } from "./manifest.ts";

/** The admin's calls as a Safe Transaction Builder batch. */
export const adminBatch = (
  m: Pick<VoteManifest, "chainId" | "contract">,
  name: string,
  calls: { fn: string; args: readonly unknown[] }[],
) => ({
  version: "1.0",
  chainId: String(m.chainId),
  meta: { name },
  transactions: calls.map((c) => ({
    to: m.contract,
    value: "0",
    data: encodeFunctionData({
      abi: SIGNED_BALLOTS_ABI,
      functionName: c.fn as never,
      args: c.args as never,
    }),
  })),
});
