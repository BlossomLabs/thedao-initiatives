import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, type Hex, http, type PublicClient } from "viem";
import { signTypedData, writeContract } from "wagmi/actions";
import { api, ApiError } from "~/lib/api";
import { useWallet } from "~/context/wallet";
import { liveConnector } from "~/lib/wallet-store";
import { useEnsureVoteChain } from "~/hooks/use-vote-chain";
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
import type { Tier } from "../../shared/vote/ballot";
import { MAINNET_CHAIN_ID, ROUND, voteChain } from "../../shared/vote/manifest";
import { checkBallotTx } from "../../shared/vote/receipt";
import { recordVote } from "../../shared/vote/record";

const SEPOLIA_RPC = (import.meta.env?.VITE_SEPOLIA_RPC_URL as string | undefined) ||
  "https://ethereum-sepolia-rpc.publicnode.com";
const MAINNET_RPC = (import.meta.env?.VITE_RPC_URL as string | undefined) ||
  "https://ethereum-rpc.publicnode.com";
const WAIT_MS = 3 * 60_000;

let client: PublicClient | null = null;
/** Reads the round's chain from the browser (receipts, nonces, self-send). */
export const voteClient = (): PublicClient => (client ??= createPublicClient({
  chain: voteChain(),
  transport: http(ROUND.chainId === MAINNET_CHAIN_ID ? MAINNET_RPC : SEPOLIA_RPC),
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
export function useVoteBallots(refetchInterval: number | false = false, enabled = true) {
  return useQuery({
    queryKey: ["vote-ballots"],
    queryFn: () => api<VoteBallots>("/api/vote/ballots", { passive: true }),
    refetchInterval,
    retry: false,
    enabled,
  });
}

export type RoundTier =
  | { tier: Tier; status: "waiting"; startsAt: number }
  | {
    tier: Tier;
    status: "settling";
    window: number;
    windowEndsAt: number;
    latestEndAt: number;
    quiet: boolean;
    funded: string[];
  }
  | {
    tier: Tier;
    status: "settled";
    at: number;
    forced: boolean;
    funded: string[];
    /** Micro-USD per initiative, as decimal strings. */
    awards: Record<string, string>;
    /** tokenId → slug → micro-USD that badge paid for it (only what it paid). */
    paid?: Record<string, Record<string, string>>;
  };
/** GET /api/vote/round: the quiet ending as it stands. */
export type RoundView = {
  registrationClosesAt: number;
  closed: boolean;
  /** Each voting badge's equal share of the pool, micro-USD. */
  share?: string;
  tiers: RoundTier[];
  /** tokenId → the ballot that counts (hex). */
  accepted: Record<string, string>;
  rejected: {
    tokenId: string;
    nonce: number;
    reason: "tier_settled" | "registration_closed" | "invalid_ballot";
  }[];
  /** The pool on-chain now (micro-USD): what a new ballot's size is judged against. */
  poolUsd?: string;
  live: {
    funded: string[];
    awards: Record<string, string>;
    tiers?: Record<string, Tier>;
    /** tokenId → slug → micro-USD that badge would pay for it if the open tiers settled
     * now (only what it would pay). */
    paid?: Record<string, Record<string, string>>;
    /** Each unsettled initiative's gap to its next tier; absent once the round is closed. */
    next?: Record<string, NextTierEntry>;
    /** While S-Tier is open: how far ahead each of its initiatives is, micro-USD
     * (only leads of at least $1K). */
    lead?: Record<string, string>;
  };
  /** Once closed: each initiative's gap to the tier above where it finished, judged at
   * that tier's settlement (comesIn/dropsOut name only the target tier), and S-Tier's
   * leads (micro-USD, at least $1K). Absent until computed. */
  final?: { next: Record<string, NextTierEntry>; lead: Record<string, string> };
};

export type NextTierEntry = {
  tier: Tier;
  /** Micro-USD; null when no amount alone gets it there. */
  gap: string | null;
  comesIn: { slug: string; tier: Tier }[];
  dropsOut: { slug: string; tier: Tier }[];
  moves: { slug: string; from: Tier; to: Tier }[];
};

const CLOSED_POLL_MS = 15_000;

/** How often a page that polls every `refetchInterval` asks for the round in `view`'s state. */
export function roundPollInterval(
  view: RoundView | undefined,
  refetchInterval: number | false,
): number | false {
  if (!view?.closed || refetchInterval === false) return refetchInterval;
  // The tally can't change once the round is over, but the final what-ifs are worked
  // out in the background after it closes and only come in a later response: wait for
  // them, at an unhurried pace, then stop.
  return view.final ? false : Math.max(refetchInterval, CLOSED_POLL_MS);
}

/** The round's quiet ending (each tier's state, what counts, what was refused). */
export function useVoteRound(refetchInterval: number | false = false, enabled = true) {
  return useQuery({
    queryKey: ["vote-round"],
    enabled,
    queryFn: () => api<RoundView>("/api/vote/round", { passive: true }),
    refetchInterval: (q) => roundPollInterval(q.state.data, refetchInterval),
    retry: false,
  });
}

/** A review badge's own star ratings, by initiative id (only what it rated). */
export function useBadgeRatings(tokenId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["vote-ratings", tokenId],
    enabled: enabled && tokenId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const r = await api<{ ratings: Record<string, { mine: number | null }> }>(
        `/api/reviews/ratings?tokenId=${tokenId}`,
      );
      return Object.fromEntries(
        Object.entries(r.ratings).flatMap(([id, x]) => (x.mine ? [[id, x.mine]] : [])),
      );
    },
  });
}

/** The badges the signed-in account votes with in this round (the voting badges it
 * holds in the real vote; its one test badge in a test vote), ascending. Off until
 * `me` is known. */
export function useMyBadges(me: string | null, enabled = true) {
  return useQuery({
    queryKey: ["vote-mine", me?.toLowerCase()],
    enabled: enabled && Boolean(me),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<number[]> => (await api<{ ids: number[] }>("/api/vote/mine")).ids,
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
      const r = await voteClient().waitForTransactionReceipt({ hash, timeout: WAIT_MS });
      if (r.status !== "success") throw new Error("The mint failed on-chain. Try again.");
    },
  };
}

const read = <T>(functionName: string, args: readonly unknown[]) =>
  voteClient().readContract({
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
  const pub = voteClient();
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
  const ensureChain = useEnsureVoteChain();
  const [phase, setPhase] = useState<BallotPhase>({ kind: "idle" });
  const [last, setLast] = useState<Signed | null>(
    () => (tokenId === null ? null : loadLast(tokenId)),
  );
  // Another badge (the picker): its own last ballot and a fresh status, never this one's.
  const [forToken, setForToken] = useState(tokenId);
  if (forToken !== tokenId) {
    setForToken(tokenId);
    setLast(tokenId === null ? null : loadLast(tokenId));
    setPhase({ kind: "idle" });
  }

  const deps = useMemo<FlowDeps>(() => ({
    ensureChain,
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
      await voteClient().waitForTransactionReceipt({ hash, timeout: WAIT_MS });
    },
    sendOwn: (s, proof) => {
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      return writeContract(wallet.config, {
        address: ROUND.contract,
        abi: SIGNED_BALLOTS_ABI,
        // record(): plain ECDSA, so EIP-7702 wallets work too (see recordVote).
        functionName: "record",
        args: [[recordVote({ ...s, proof })]],
        chainId: ROUND.chainId,
        account: wallet.address,
        connector: liveConnector(wallet),
      } as never);
    },
  }), [ensureChain, wallet]);

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
