/** What a round admin's wallet does from the admin pages: sign a pledge of Pledges to
 * sign, and Put on the ballot. The round and its API paths follow the vote environment
 * the components render in (RoundAdminQueue provides it). */
import { useCallback, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Hex } from "viem";
import { writeContract } from "wagmi/actions";
import { api, ApiError } from "~/lib/api";
import { shortAddr } from "~/lib/format";
import type { ReadyJson, RoundAdminQueueJson } from "~/lib/api-types";
import {
  type BallotAddDeps,
  type BallotPhase,
  isDuplicateInitiative,
  prepareInRound,
  putOnBallot,
} from "~/lib/ballot-add";
import {
  type PledgeFlowDeps,
  type PledgePhase,
  sendPledge,
  type SettleState,
} from "~/lib/pledge-flow";
import { primeRound, scopeVotePath, useRound, useVoteEnvironment } from "~/lib/vote-round";
import { dropLock, resetLock, takeLock } from "~/lib/signing-lock";
import { useWallet } from "~/context/wallet";
import { liveConnector } from "~/lib/wallet-store";
import { useEnsureVoteChain } from "~/hooks/use-vote-chain";
import { voteClient } from "~/hooks/use-vote-send";
import {
  busyOf,
  chainName,
  type PreparedPledge,
  RECEIPT_WAIT_MS,
  signPrepared,
} from "~/components/admin/initiative/Pledges";
import { SIGNED_BALLOTS_ABI } from "../../../../shared/vote/abi";
import { addPlan } from "../../../../shared/vote/add-plan";
import { voteBase, type VoteEnvironment } from "../../../../shared/vote/environment";
import type { VoteManifest } from "../../../../shared/vote/manifest";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET /queue settles pending records as it reads: never more often than this. */
const QUEUE_REFRESH_MS = 15_000;

/** The page's one signing lock (~/lib/signing-lock), for the round admin's lists. */
export { dropLock, takeLock, useLocked } from "~/lib/signing-lock";

export const roundAdminQueueKey = (env: VoteEnvironment) =>
  ["admin", "round-admin-queue", env] as const;

/** Waiting for a round admin, for the round of `env`. */
export function useRoundAdminQueue(env: VoteEnvironment, enabled = true) {
  return useQuery({
    queryKey: roundAdminQueueKey(env),
    enabled,
    refetchInterval: QUEUE_REFRESH_MS,
    staleTime: 10_000,
    queryFn: ({ signal }) =>
      api<RoundAdminQueueJson>(scopeVotePath("/api/admin/vote-round/queue", env), { signal }),
  });
}

export type SignTarget = {
  rfpId: string;
  slug: string;
  pid: string;
  /** Signed right after Put on the ballot: a prepare's 404 is tried again for a while
   * (`prepareInRound`). */
  afterAdd?: boolean;
};

/**
 * What is under way, kept outside the components: an initiative put on the ballot leaves
 * Ready for the ballot (and its card leaves the page) while its pledges are still being
 * signed, and a pledge being signed shows in every list that has it.
 */
export type BallotRun = {
  env: VoteEnvironment;
  ready: ReadyJson;
  phase: BallotPhase;
  /** The last transaction sent. */
  hash: Hex | null;
  /** How many of its pledges were signed. */
  signed: number;
  /** Another admin's add landed first (DuplicateInitiative). */
  already: boolean;
};
let runs: readonly BallotRun[] = [];
let sendingSet: ReadonlySet<string> = new Set();
/** When each pledge last ended a signing that sent something (ms): the lists' rows are a
 * snapshot, and a pledge sent since must not be signed again from it. */
let sentAt: ReadonlyMap<string, number> = new Map();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((fn) => fn());
const runKey = (env: VoteEnvironment, slug: string) => `${env}:${slug}`;
function setRun(run: BallotRun) {
  const key = runKey(run.env, run.ready.slug);
  runs = [...runs.filter((r) => runKey(r.env, r.ready.slug) !== key), run];
  emit();
}
function setSending(pid: string, on: boolean) {
  const next = new Set(sendingSet);
  if (on) next.add(pid);
  else next.delete(pid);
  sendingSet = next;
  emit();
}
function markSent(pid: string) {
  sentAt = new Map(sentAt).set(pid, Date.now());
  emit();
}
/** Pledges sent since `asOf` (ms): a list's rows from before then are out of date. */
export const useSentAt = (): ReadonlyMap<string, number> =>
  useSyncExternalStore(subscribe, () => sentAt, () => sentAt);
export const sentSince = (pid: string, asOf: number) => (sentAt.get(pid) ?? -1) >= asOf;
/** Every Put on the ballot of `env` started on this page load. */
export function useBallotRuns(env: VoteEnvironment): BallotRun[] {
  const all = useSyncExternalStore(subscribe, () => runs, () => runs);
  return all.filter((r) => r.env === env);
}
/** The pledges being signed now, from any list or card. */
export const useSending = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, () => sendingSet, () => sendingSet);
/** The same, read at once (inside a running Sign all). */
export const isSending = (pid: string) => sendingSet.has(pid);
/** For tests: forget every run. */
export function resetRoundAdminRuns() {
  runs = [];
  sendingSet = new Set();
  sentAt = new Map();
  resetLock();
  emit();
}

/**
 * Signs pledges of Pledges to sign (the caller holds the signing lock, and refreshes the
 * admin queries once it is done with them all): the API gives the typed data for the item's change,
 * the wallet signs it, the API relays it, and the browser waits for the receipt and has
 * it settled (pledge-flow.ts). `sending`: the pledges being signed right now.
 */
export function useQueueSign() {
  const ROUND = useRound();
  const env = useVoteEnvironment();
  const wallet = useWallet();
  const ensureChain = useEnsureVoteChain();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<PledgePhase>({ kind: "idle" });

  const sign = useCallback(
    async ({ rfpId, slug, pid, afterAdd = false }: SignTarget): Promise<PledgePhase> => {
      const path = scopeVotePath(`/api/admin/vote-round/queue/${rfpId}/${pid}`, env);
      // The real round settles the site's row; a test pledge only checks the chain.
      const settlePath = (id: string) =>
        ROUND.kind === "real"
          ? `/api/admin/initiatives/${rfpId}/pledges/${id}/settle`
          : scopeVotePath(`/api/admin/vote-round/test-pledges/${slug}/pledges/${id}/settle`, env);
      const deps: PledgeFlowDeps<PreparedPledge> = {
        chain: chainName(ROUND),
        // Every item of the list needs a signature.
        plain: () => Promise.resolve("sign"),
        prepare: async () => {
          const once = () => api<PreparedPledge>(`${path}/prepare`, { json: {} });
          try {
            return afterAdd
              ? await prepareInRound(once, sleep, (e) => e instanceof ApiError && e.status === 404)
              : await once();
          } catch (e) {
            const busy = busyOf(e);
            if (busy) return busy;
            throw e;
          }
        },
        sign: ({ typedData }) => signPrepared(wallet, ensureChain, typedData),
        send: async ({ typedData }, signature) => {
          const m = typedData.message;
          try {
            const r = await api<{ hash?: Hex | null; pid?: string }>(path, {
              json: { pid, nonce: m.nonce, deadline: m.deadline, signature },
            });
            return r && "hash" in r && typeof r.pid === "string"
              ? { hash: r.hash ?? null, pid: r.pid }
              : { saved: true as const };
          } catch (e) {
            const busy = busyOf(e);
            if (busy) return busy;
            throw e;
          }
        },
        waitReceipt: async (hash) =>
          (await voteClient(ROUND).waitForTransactionReceipt({ hash, timeout: RECEIPT_WAIT_MS }))
            .status,
        settle: async (id, hash) =>
          (await api<{ state: SettleState }>(settlePath(id), { json: { hash } }))
            .state,
        sleep,
      };
      setSending(pid, true);
      setPhase({ kind: "idle" });
      try {
        const end = await sendPledge(deps, setPhase);
        if (end.kind === "saved" || end.kind === "recorded" || ("hash" in end && end.hash)) {
          markSent(pid);
        }
        return end;
      } finally {
        setSending(pid, false);
      }
    },
    [ROUND, env, wallet, ensureChain],
  );
  /** Once, after a Sign, a Sign all or a run: GET /queue is never read in a burst. */
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ["admin"] }), [qc]);
  return { sign, phase, refresh };
}

/** The card's fields the round's add plan needs. */
export const cardOf = (r: ReadyJson) => ({
  slug: r.slug,
  goalUsd: r.goalUsd,
  safeAddress: r.safeAddress,
  type: r.type,
  raisedUsd: r.raisedUsd,
  affiliations: r.affiliations,
});

/** Put on the ballot (ballot-add.ts) with the connected wallet. */
export function usePutOnBallot(ready: ReadyJson) {
  const ROUND = useRound();
  const env = useVoteEnvironment();
  const wallet = useWallet();
  const ensureChain = useEnsureVoteChain();
  const qc = useQueryClient();
  const { sign } = useQueueSign();
  const run = useBallotRuns(env).find((r) => r.ready.slug === ready.slug);
  const busy = !!run && run.phase.kind !== "done" && run.phase.kind !== "failed";
  const start = useCallback(async () => {
    const owner = `run:${env}:${ready.slug}`;
    if (!takeLock(owner)) return null;
    let at: BallotRun = {
      env,
      ready,
      phase: { kind: "adding", step: 1, of: 1 },
      hash: null,
      signed: 0,
      already: false,
    };
    const onPhase = (phase: BallotPhase) => {
      at = {
        ...at,
        phase,
        hash: phase.kind === "adding" && phase.hash ? phase.hash : at.hash,
        signed: phase.kind === "signing"
          ? phase.done
          : phase.kind === "done"
          ? ready.pledges.length
          : at.signed,
        already: at.already || (phase.kind === "waiting-round" && !!phase.already),
      };
      setRun(at);
    };
    const claimPath = scopeVotePath(`/api/admin/vote-round/ballot-claims/${ready.id}`, env);
    const deps: BallotAddDeps = {
      claim: async () => {
        try {
          await api(claimPath, { json: {} });
          return "ok";
        } catch (e) {
          const body = e instanceof ApiError ? e.body as { code?: string; by?: string } : null;
          if (body?.code === "ballot_claimed" && body.by) return { by: shortAddr(body.by) };
          throw e;
        }
      },
      release: async () => {
        await api(claimPath, { method: "DELETE" });
      },
      plan: async () => {
        // The round as it is now (a fresh read: the browser may hold it for 10 s), so a
        // retry never adds an affiliation that landed already.
        const r = await api<{ manifest: VoteManifest | null }>(
          `/api${voteBase(env)}/manifest?t=${Date.now()}`,
        );
        const m = r.manifest;
        if (!m || m.contract.toLowerCase() !== ROUND.contract.toLowerCase()) {
          throw new Error("The round couldn't be read. Reload the page and try again.");
        }
        primeRound(m, env);
        return m.slugs.includes(ready.slug) ? [] : addPlan(m, [cardOf(ready)]).calls;
      },
      send: async (call) => {
        if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
        await ensureChain();
        return await writeContract(wallet.config, {
          address: ROUND.contract,
          abi: SIGNED_BALLOTS_ABI,
          functionName: call.fn as never,
          args: call.args as never,
          chainId: ROUND.chainId,
          account: wallet.address,
          connector: liveConnector(wallet),
        } as never);
      },
      waitReceipt: async (hash, call) => {
        const client = voteClient(ROUND);
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_WAIT_MS });
        if (receipt.status === "reverted" && call.fn === "addInitiative") {
          // A receipt carries no reason: the call again at that block says whether another
          // admin's add landed first (DuplicateInitiative), which the run goes on from.
          const why = await client.simulateContract({
            address: ROUND.contract,
            abi: SIGNED_BALLOTS_ABI,
            functionName: call.fn,
            args: call.args as never,
            account: wallet.address,
            blockNumber: receipt.blockNumber,
          } as never).then(() => null, (e: unknown) => e);
          if (isDuplicateInitiative(why)) throw why;
        }
        return receipt.status;
      },
      inRound: async () => {
        // A fresh read each time: the browser may hold the manifest for 10 s.
        const r = await api<{ manifest: VoteManifest | null }>(
          `/api${voteBase(env)}/manifest?t=${Date.now()}`,
        );
        if (!r.manifest?.slugs.includes(ready.slug)) return false;
        primeRound(r.manifest, env);
        return true;
      },
      signPledge: async (pid) => {
        const end = await sign({ rfpId: ready.id, slug: ready.slug, pid, afterAdd: true });
        return end.kind === "saved" || end.kind === "recorded" ? "saved" : "failed";
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    try {
      return await putOnBallot(deps, ready, onPhase);
    } finally {
      dropLock(owner);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    }
  }, [ROUND, env, wallet, ensureChain, qc, ready, sign]);
  return { start, run, busy };
}
