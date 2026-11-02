import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbiItem,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { SIGNED_BALLOTS_ABI } from "../../shared/devcon/abi.ts";
import type { DevconManifest } from "../../shared/devcon/manifest.ts";

/** What the DevCon routes need from Sepolia. Injected so tests run without a chain. */
export interface DevconChain {
  ownerOf(n: bigint): Promise<Hex | null>;
  balanceOf(a: Hex): Promise<bigint>;
  hasCode(a: Hex): Promise<boolean>;
  nonceOf(n: bigint): Promise<bigint>;
  balance(a: Hex): Promise<bigint>;
  /** A relayed transaction's fate; "unknown" when the node has never seen it (dropped). */
  txStatus(hash: Hex): Promise<"pending" | "success" | "reverted" | "unknown">;
  /** Gas cost (wei) of one recordFor at the current gas price. */
  estimateRecordFor(): Promise<bigint>;
  send(
    call:
      | { fn: "mint"; args: readonly [Hex, bigint] }
      | { fn: "recordFor"; args: readonly [bigint, bigint, Hex, Hex] }
      | { fn: "drip"; to: Hex; value: bigint },
  ): Promise<Hex>;
  /** Every BallotRecorded since the deploy block, oldest first. */
  ballots(): Promise<{ tokenId: string; ballot: Hex; timestamp: number }[]>;
}

export interface Devcon {
  chain: DevconChain;
  manifest: DevconManifest;
}

const BALLOT_RECORDED = parseAbiItem(
  "event BallotRecorded(uint256 indexed tokenId, address indexed voter, uint64 nonce, bytes ballot)",
);
const LOG_CHUNK = 50_000n;

export function createDevconChain(
  m: DevconManifest,
  rpcUrl: string,
  relayerKey: Hex | null,
): DevconChain {
  const pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl) }) as PublicClient;
  const account = relayerKey ? privateKeyToAccount(relayerKey) : null;
  const wallet = account
    ? createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) })
    : null;
  const read = <T>(functionName: string, args: readonly unknown[]) =>
    pub.readContract({
      address: m.contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;
  const blockTimes = new Map<bigint, number>();

  return {
    async ownerOf(n) {
      try {
        return await read<Hex>("ownerOf", [n]);
      } catch (e) {
        // ERC721NonexistentToken: not minted yet.
        if (String(e).includes("ERC721NonexistentToken")) return null;
        throw e;
      }
    },
    balanceOf: (a) => read<bigint>("balanceOf", [a]),
    hasCode: async (a) => ((await pub.getCode({ address: a })) ?? "0x") !== "0x",
    nonceOf: async (n) => BigInt(await read<bigint>("nonceOf", [n])),
    balance: (a) => pub.getBalance({ address: a }),
    async txStatus(hash) {
      const r = await pub.getTransactionReceipt({ hash }).catch(() => null);
      if (r) return r.status === "success" ? "success" : "reverted";
      const tx = await pub.getTransaction({ hash }).catch(() => null);
      return tx ? "pending" : "unknown";
    },
    async estimateRecordFor() {
      // A recordFor of an 81-byte ballot uses well under 150k gas.
      return 150_000n * (await pub.getGasPrice());
    },
    async send(call) {
      if (!wallet || !account) throw new Error("DEVCON_RELAYER_KEY is not configured");
      const nonce = await pub.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      if (call.fn === "drip") {
        return await wallet.sendTransaction({ to: call.to, value: call.value, nonce });
      }
      return await wallet.writeContract({
        address: m.contract,
        abi: SIGNED_BALLOTS_ABI,
        functionName: call.fn as never,
        args: call.args as never,
        nonce,
      });
    },
    async ballots() {
      const head = await pub.getBlockNumber();
      const out: { tokenId: string; ballot: Hex; timestamp: number }[] = [];
      for (let from = BigInt(m.deployBlock); from <= head; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
        const logs = await pub.getLogs({
          address: m.contract,
          event: BALLOT_RECORDED,
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          let t = blockTimes.get(log.blockNumber!);
          if (t === undefined) {
            t = Number((await pub.getBlock({ blockNumber: log.blockNumber! })).timestamp);
            blockTimes.set(log.blockNumber!, t);
          }
          out.push({
            tokenId: log.args.tokenId!.toString(),
            ballot: log.args.ballot!,
            timestamp: t,
          });
        }
      }
      return out;
    },
  };
}
