import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, type Hex, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { signTypedData, writeContract } from "wagmi/actions";
import { api, ApiError } from "~/lib/api";
import { useWallet } from "~/context/wallet";
import { liveConnector } from "~/lib/wallet-store";
import { useEnsureSepolia } from "~/hooks/use-sepolia";
import {
  type BallotPhase,
  check,
  type FlowDeps,
  retryBallot,
  selfSendBallot,
  type Signed,
  submitBallot,
} from "~/lib/vote-flow";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi";
import { ROUND } from "../../shared/vote/manifest";
import { checkBallotTx } from "../../shared/vote/receipt";
import { recordVote } from "../../shared/vote/record";

const SEPOLIA_RPC = (import.meta.env?.VITE_SEPOLIA_RPC_URL as string | undefined) ||
  "https://ethereum-sepolia-rpc.publicnode.com";
const WAIT_MS = 3 * 60_000;

let client: PublicClient | null = null;
export const sepoliaClient = (): PublicClient => (client ??= createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
}) as PublicClient);

export type CodeInfo = { n: number; claimed: boolean; owner: string | null };

/** The paper code's number and whether it is claimed; `bad` for a code the issuer never signed. */
export function useVoteCode(code: string, enabled = true) {
  return useQuery({
    queryKey: ["vote-code", code],
    enabled,
    queryFn: async (): Promise<CodeInfo | "bad"> => {
      try {
        return await api<CodeInfo>(`/api/vote/code/${encodeURIComponent(code)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 400) return "bad";
        throw e;
      }
    },
  });
}

export type VoteBallots = { at: number; ballots: { tokenId: string; ballot: Hex }[] };

/** Every badge's latest ballot sent before the close (the vote results poll it). */
export function useVoteBallots(refetchInterval: number | false = false) {
  return useQuery({
    queryKey: ["vote-ballots"],
    queryFn: () => api<VoteBallots>("/api/vote/ballots", { passive: true }),
    refetchInterval,
    retry: false,
  });
}

/** The signed-in account's badge (found on-chain), as a code's info would say it;
 * `none` when the account holds no badge in this round. Off until `me` is known. */
export function useMyBadge(me: string | null, enabled = true) {
  return useQuery({
    queryKey: ["vote-mine", me?.toLowerCase()],
    enabled: enabled && Boolean(me),
    queryFn: async (): Promise<CodeInfo | "none"> => {
      const { n } = await api<{ n: number | null }>("/api/vote/mine");
      return n === null ? "none" : { n, claimed: true, owner: me };
    },
  });
}

export const apiCode = (e: unknown): string | undefined =>
  e instanceof ApiError && e.body && typeof e.body === "object" && "code" in e.body
    ? String((e.body as { code: unknown }).code)
    : undefined;

/** Waits for a mint to land so the ballot can be shown. */
export function useMintWait() {
  return {
    wait: async (hash: Hex) => {
      const r = await sepoliaClient().waitForTransactionReceipt({ hash, timeout: WAIT_MS });
      if (r.status !== "success") throw new Error("The mint failed on-chain. Try again.");
    },
  };
}

const read = <T>(functionName: string, args: readonly unknown[]) =>
  sepoliaClient().readContract({
    address: ROUND.contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: functionName as never,
    args: args as never,
  }) as Promise<T>;

const storeKey = (tokenId: bigint) => `vote-last:${ROUND.contract}:${tokenId}`;
function loadLast(tokenId: bigint): Signed | null {
  try {
    const raw = sessionStorage.getItem(storeKey(tokenId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return { ...v, tokenId: BigInt(v.tokenId), nonce: BigInt(v.nonce) };
  } catch {
    return null;
  }
}
function saveLast(s: Signed | null) {
  if (!s) return;
  try {
    sessionStorage.setItem(
      storeKey(s.tokenId),
      JSON.stringify({ ...s, tokenId: s.tokenId.toString(), nonce: s.nonce.toString() }),
    );
  } catch { /* storage unavailable */ }
}

export async function waitResult(
  hash: Hex,
  expect: { tokenId: bigint; nonce: bigint; ballot: Hex },
) {
  const pub = sepoliaClient();
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: WAIT_MS });
  const [tx, block] = await Promise.all([
    pub.getTransaction({ hash }),
    pub.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  return checkBallotTx({
    m: ROUND,
    tx: { to: tx.to, input: tx.input },
    status: receipt.status,
    blockTimestamp: Number(block.timestamp),
    expect,
  });
}

/** Sign, relay, wait and check one ballot; Retry and the last send survive a reload. */
export function useBallotSubmit(tokenId: bigint | null) {
  const wallet = useWallet();
  const ensureSepolia = useEnsureSepolia();
  const [phase, setPhase] = useState<BallotPhase>({ kind: "idle" });
  const [last, setLast] = useState<Signed | null>(
    () => (tokenId === null ? null : loadLast(tokenId)),
  );

  const deps = useMemo<FlowDeps>(() => ({
    ensureSepolia,
    signVote: (typed) => {
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      return signTypedData(wallet.config, {
        ...typed,
        account: wallet.address,
        connector: liveConnector(wallet),
      } as never);
    },
    relay: async (body) => {
      try {
        const r = await api<{ hash: Hex }>("/api/vote/ballot", {
          method: "POST",
          json: {
            tokenId: body.tokenId.toString(),
            nonce: body.nonce.toString(),
            ballot: body.ballot,
            signature: body.signature,
          },
        });
        return r.hash;
      } catch (e) {
        if (apiCode(e) === "pending" && e instanceof ApiError) {
          return (e.body as { hash: Hex }).hash;
        }
        throw e;
      }
    },
    nonceOf: async (id) => BigInt(await read<bigint>("nonceOf", [id])),
    ballotHashOf: (id) => read<Hex>("ballotHashOf", [id]),
    waitResult,
    requestGas: async (id) =>
      (await api<{ hash: Hex | null }>("/api/vote/gas", {
        method: "POST",
        json: { tokenId: id.toString() },
      })).hash,
    waitTx: async (hash) => {
      await sepoliaClient().waitForTransactionReceipt({ hash, timeout: WAIT_MS });
    },
    sendOwn: (s) => {
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      return writeContract(wallet.config, {
        address: ROUND.contract,
        abi: SIGNED_BALLOTS_ABI,
        // record(): plain ECDSA, so EIP-7702 wallets work too (see recordVote).
        functionName: "record",
        args: [[recordVote(s)]],
        chainId: ROUND.chainId,
        account: wallet.address,
        connector: liveConnector(wallet),
      } as never);
    },
  }), [ensureSepolia, wallet]);

  const keep = useCallback((s: Signed | null) => {
    if (!s) return;
    setLast(s);
    saveLast(s);
  }, []);

  const submit = useCallback(async (id: bigint, ballot: Hex) => {
    if (!wallet.address) return;
    keep(await submitBallot(deps, ROUND, id, wallet.address, ballot, setPhase));
  }, [deps, keep, wallet.address]);

  const retry = useCallback(async () => {
    if (!last || !wallet.address) return;
    keep(await retryBallot(deps, ROUND, wallet.address, last, setPhase));
  }, [deps, keep, last, wallet.address]);

  /** A hash the voter sent themselves goes through the same check. */
  const track = useCallback(async (hash: Hex, signed: Signed) => {
    keep({ ...signed, hash });
    await check(deps, signed, hash, setPhase);
  }, [deps, keep]);

  const selfSend = useCallback(async (id: bigint, ballot: Hex) => {
    if (!wallet.address) return;
    keep(await selfSendBallot(deps, ROUND, id, wallet.address, ballot, last, setPhase));
  }, [deps, keep, last, wallet.address]);

  return { phase, submit, retry, selfSend, track, last, deps };
}
