import { encodeFunctionData } from "viem";
import { SIGNED_BALLOTS_ABI } from "./abi.ts";
import type { VoteManifest } from "./manifest.ts";

/** The admin's calls as a Safe Transaction Builder batch. When the calls add affiliations,
 * the batch first requires the round's configuration revision the plan was read at
 * (`m.configRevision`, #147): the ids the plan gave the new affiliations are still theirs,
 * or nothing runs. Calls that require it themselves (corrections) are left as they are. */
export const adminBatch = (
  m: Pick<VoteManifest, "chainId" | "contract"> & Partial<Pick<VoteManifest, "configRevision">>,
  name: string,
  calls: { fn: string; args: readonly unknown[] }[],
) => {
  const guarded = m.configRevision !== undefined && calls.some((c) => c.fn === "addGroup") &&
    !calls.some((c) => c.fn === "requireConfigRevision");
  const all = guarded
    ? [{ fn: "requireConfigRevision", args: [BigInt(m.configRevision!)] }, ...calls]
    : calls;
  return {
    version: "1.0",
    chainId: String(m.chainId),
    meta: { name },
    transactions: all.map((c) => ({
      to: m.contract,
      value: "0",
      data: encodeFunctionData({
        abi: SIGNED_BALLOTS_ABI,
        functionName: c.fn as never,
        args: c.args as never,
      }),
    })),
  };
};
