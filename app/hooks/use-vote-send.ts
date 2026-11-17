import { ballotStorageKey, roundId } from "../../shared/vote/keys";
/** Sending a ballot and waiting for mints: the wallet, signing and the chain client.
 * Kept apart from use-vote.ts so the pages that only show the vote never load it. */
import { useCallback, useMemo, useRef, useState } from "react";
import { createPublicClient, type Hex, http, type PublicClient } from "viem";
import { signTypedData, writeContract } from "wagmi/actions";
import { api, ApiError } from "~/lib/api";
import { apiCode } from "~/hooks/use-vote";
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
import { MAINNET_CHAIN_ID, ROUND, voteChain, type VoteManifest } from "../../shared/vote/manifest";
import { checkBallotTx } from "../../shared/vote/receipt";
import { contractOwner, recordVote } from "../../shared/vote/record";

const SEPOLIA_RPC = (import.meta.env?.VITE_SEPOLIA_RPC_URL as string | undefined) ||
  "https://ethereum-sepolia-rpc.publicnode.com";
const MAINNET_RPC = (import.meta.env?.VITE_RPC_URL as string | undefined) ||
  "https://ethereum-rpc.publicnode.com";
const WAIT_MS = 3 * 60_000;

let client: { chainId: number; pub: PublicClient } | null = null;
/** Reads the round's chain from the browser (receipts, nonces, self-send). */
export const voteClient = (m: VoteManifest = ROUND): PublicClient => {
  if (client?.chainId !== m.chainId) {
    client = {
      chainId: m.chainId,
      pub: createPublicClient({
        chain: voteChain(m),
        transport: http(m.chainId === MAINNET_CHAIN_ID ? MAINNET_RPC : SEPOLIA_RPC),
      }) as PublicClient,
    };
  }
  return client.pub;
};

const read = <T>(m: VoteManifest, functionName: string, args: readonly unknown[]) =>
  voteClient(m).readContract({
    address: m.contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: functionName as never,
    args: args as never,
  }) as Promise<T>;

const storeKey = (tokenId: bigint, m: VoteManifest = ROUND) => ballotStorageKey("last", m, tokenId);
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
function saveLast(s: Signed | null, m: VoteManifest) {
  if (!s) return;
  try {
    sessionStorage.setItem(
      storeKey(s.tokenId, m),
      JSON.stringify({ ...s, tokenId: s.tokenId.toString(), nonce: s.nonce.toString() }),
    );
  } catch { /* storage unavailable */ }
}

export async function waitResult(
  hash: Hex,
  expect: { tokenId: bigint; nonce: bigint; ballot: Hex },
  m: VoteManifest = ROUND,
) {
  const pub = voteClient(m);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: WAIT_MS });
  const [tx, block] = await Promise.all([
    pub.getTransaction({ hash }),
    pub.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  return checkBallotTx({
    m,
    tx: { to: tx.to, input: tx.input },
    status: receipt.status,
    logs: receipt.logs,
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
  const identity = `${roundId(ROUND)}:${tokenId}`;
  const [forToken, setForToken] = useState(identity);
  if (forToken !== identity) {
    setForToken(identity);
    setLast(tokenId === null ? null : loadLast(tokenId));
    setPhase({ kind: "idle" });
  }

  const active = useRef(identity);
  active.current = identity;
  const m = useMemo(() => ({ ...ROUND }), [identity, ROUND]);
  const setCurrentPhase = useCallback((p: BallotPhase) => {
    if (active.current === identity) setPhase(p);
  }, [identity]);
  const assertCurrent = useCallback(() => {
    if (active.current !== identity) {
      throw new Error("The voting round or badge changed. Reopen your ballot before sending.");
    }
  }, [identity]);
  const deps = useMemo<FlowDeps>(() => ({
    ensureChain: async () => {
      assertCurrent();
      await ensureChain();
      assertCurrent();
    },
    isContractOwner: async (owner) =>
      contractOwner((await voteClient(m).getCode({ address: owner })) ?? "0x"),
    sendDirect: (s, proof) => {
      assertCurrent();
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      return writeContract(wallet.config, {
        address: m.contract,
        abi: SIGNED_BALLOTS_ABI,
        functionName: "vote",
        args: [s.tokenId, s.nonce, s.ballot, proof],
        chainId: m.chainId,
        account: wallet.address,
        connector: liveConnector(wallet),
      });
    },
    signVote: (typed) => {
      assertCurrent();
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      return signTypedData(wallet.config, {
        ...typed,
        account: wallet.address,
        connector: liveConnector(wallet),
      } as never);
    },
    relay: async (body) => {
      assertCurrent();
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
    nonceOf: async (id) => BigInt(await read<bigint>(m, "nonceOf", [id])),
    ballotHashOf: (id) => read<Hex>(m, "ballotHashOf", [id]),
    waitResult: (hash, expect) => waitResult(hash, expect, m),
    requestGas: async (id) => {
      assertCurrent();
      return (await api<{ hash: Hex | null }>("/api/vote/gas", {
        method: "POST",
        json: { tokenId: id.toString() },
      })).hash;
    },
    waitTx: async (hash) => {
      await voteClient(m).waitForTransactionReceipt({ hash, timeout: WAIT_MS });
    },
    sendOwn: (s, proof) => {
      assertCurrent();
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      return writeContract(wallet.config, {
        address: m.contract,
        abi: SIGNED_BALLOTS_ABI,
        // record(): plain ECDSA, so EIP-7702 wallets work too (see recordVote).
        functionName: "record",
        args: [[recordVote({ ...s, proof })]],
        chainId: m.chainId,
        account: wallet.address,
        connector: liveConnector(wallet),
      } as never);
    },
  }), [ensureChain, wallet, m, assertCurrent]);

  const keep = useCallback((s: Signed | null) => {
    if (!s) return;
    if (active.current === identity) setLast(s);
    saveLast(s, m);
  }, [identity, m]);

  const submit = useCallback(async (id: bigint, ballot: Hex) => {
    if (!wallet.address) return;
    keep(await submitBallot(deps, m, id, wallet.address, ballot, setCurrentPhase));
  }, [deps, keep, wallet.address, m, setCurrentPhase]);

  const retry = useCallback(async () => {
    if (!last || !wallet.address) return;
    keep(await retryBallot(deps, m, wallet.address, last, setCurrentPhase));
  }, [deps, keep, last, wallet.address, m, setCurrentPhase]);

  /** A hash the voter sent themselves goes through the same check. */
  const track = useCallback(async (hash: Hex, signed: Signed) => {
    keep({ ...signed, hash });
    await check(deps, signed, hash, setCurrentPhase);
  }, [deps, keep, setCurrentPhase]);

  const selfSend = useCallback(async (id: bigint, ballot: Hex) => {
    if (!wallet.address) return;
    keep(await selfSendBallot(deps, m, id, wallet.address, ballot, last, setCurrentPhase));
  }, [deps, keep, last, wallet.address, m, setCurrentPhase]);

  return { phase, submit, retry, selfSend, track, last, deps };
}
