/**
 * Goal changes to sign (#149): a ballot initiative's new goal waits here until a round
 * admin sets it on the round, and so does a site goal the round doesn't have (a record
 * item). The round has no signed form of `setInitiative`, so a wallet holding the admin
 * role sends it; a site admin without the role sees the list without Sign. The page takes
 * a requested goal once the round has it.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { writeContract } from "wagmi/actions";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { TodoRow } from "~/components/admin/dashboard/TodoSection";
import { AwaitingChip, RECEIPT_WAIT_MS } from "~/components/admin/initiative/Pledges";
import { useWallet } from "~/context/wallet";
import { useRoundAdmin } from "~/hooks/use-round-admin";
import { useEnsureVoteChain } from "~/hooks/use-vote-chain";
import { voteClient } from "~/hooks/use-vote-send";
import { api, errorMessage } from "~/lib/api";
import type { GoalToSignJson } from "~/lib/api-types";
import { dayTime, shortAddr, usd } from "~/lib/format";
import { useRound } from "~/lib/vote-round";
import { liveConnector } from "~/lib/wallet-store";
import { SIGNED_BALLOTS_ABI } from "../../../../shared/vote/abi";
import { settledGoalText, WITHDRAWN_GOAL } from "../../../../shared/vote/ballot-facts";

/** After a Sign: the list is read again this often until the site has the change. */
const POLL_MS = 3_000;
const POLL_FOR_MS = 2 * 60_000;

/** One goal change: the initiative, the goal it sets, and when it was asked. */
const changeKey = (g: GoalToSignJson) => `${g.rfpId}:${g.call.goalUsd}:${g.at ?? ""}`;

/** Why Sign is off for a goal change, or null. */
export function blockedReason(g: GoalToSignJson): string | null {
  const b = g.blocked;
  if (!b) return null;
  switch (b.kind) {
    case "settled":
      return settledGoalText(b.tier);
    case "withdrawn":
      return WITHDRAWN_GOAL;
    case "settling":
      return b.until === null
        ? "The vote has ended: the round takes no more changes."
        : `A tier is settling: the round takes changes again at ${dayTime(b.until)}.`;
    case "unknown":
      return "The round's state couldn't be read. Try again shortly.";
  }
}

type Phase = { kind: "idle" } | { kind: "sending"; rfpId: string } | {
  kind: "sent";
  rfpId: string;
} | { kind: "failed"; reason: string };

export default function GoalsToSign({ items }: { items: GoalToSignJson[] }) {
  const ROUND = useRound();
  const wallet = useWallet();
  const ensureChain = useEnsureVoteChain();
  const { hasAdminRole, loading } = useRoundAdmin();
  const canSign = !loading && hasAdminRole;
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** Signed here, by the change (a later request for the same initiative is another one):
   * never signed again, and the list is read until the site has it. */
  const [signed, setSigned] = useState<ReadonlySet<string>>(new Set());
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const waiting = items.some((g) => signed.has(changeKey(g)));
  useEffect(() => {
    if (!waiting) return;
    const start = Date.now();
    const t = setInterval(() => {
      if (Date.now() - start > POLL_FOR_MS) clearInterval(t);
      else refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting]);

  const sign = async (g: GoalToSignJson) => {
    setPhase({ kind: "sending", rfpId: g.rfpId });
    try {
      if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
      await ensureChain();
      // The call keeps the round's RFP flag and groups as the list read them: refuse if
      // the round changed since, so a stale list never writes back older settings.
      if (g.configRevision !== null) {
        const now = await voteClient(ROUND).readContract({
          address: ROUND.contract,
          abi: SIGNED_BALLOTS_ABI,
          functionName: "configRevision",
        });
        if (String(now) !== g.configRevision) {
          throw new Error("The round's settings changed since this list was read. Try again.");
        }
      }
      const c = g.call;
      const hash = await writeContract(wallet.config, {
        address: ROUND.contract,
        abi: SIGNED_BALLOTS_ABI,
        functionName: "setInitiative",
        args: [BigInt(c.id), c.account, BigInt(c.goalUsd), c.rfp, BigInt(c.groups)],
        chainId: ROUND.chainId,
        account: wallet.address,
        connector: liveConnector(wallet),
      } as never);
      const receipt = await voteClient(ROUND).waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_WAIT_MS,
      });
      if (receipt.status === "reverted") throw new Error("The round refused the change.");
      setSigned((s) => new Set([...s, changeKey(g)]));
      setPhase({ kind: "sent", rfpId: g.rfpId });
    } catch (e) {
      setPhase({ kind: "failed", reason: errorMessage(e) });
    } finally {
      refresh();
    }
  };

  const discard = async (g: GoalToSignJson) => {
    try {
      await api(`/api/admin/initiatives/${g.rfpId}/goal-request`, { method: "DELETE" });
    } catch (e) {
      setPhase({ kind: "failed", reason: errorMessage(e) });
    } finally {
      refresh();
    }
  };

  const busy = phase.kind === "sending";
  return (
    <div>
      {items.map((g) => {
        const reason = blockedReason(g);
        const done = signed.has(changeKey(g));
        return (
          <TodoRow key={g.rfpId}>
            <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-0.5">
              <Link
                to={`/admin/initiatives/${g.rfpId}`}
                className="font-inter-tight text-[14px] font-medium"
              >
                {g.title}
              </Link>
              <span className="small flex flex-wrap items-center gap-x-2 gap-y-1 text-white/75">
                {g.kind === "record"
                  ? <span>{`Round ${usd(g.fromUsd)}, page ${usd(g.toUsd)}`}</span>
                  : (
                    <>
                      <span>{`${usd(g.fromUsd)} → ${usd(g.toUsd)}`}</span>
                      <AwaitingChip />
                      {g.by && g.at !== null && (
                        <span className="dim">asked by {shortAddr(g.by)}, {dayTime(g.at)}</span>
                      )}
                    </>
                  )}
                {done && (
                  <span className="dim">
                    Set on the round. The list updates once the site has it.
                  </span>
                )}
              </span>
            </div>
            {g.kind === "request" && (
              <Button
                sm
                variant="ghost"
                disabled={busy || done}
                aria-label={`Discard ${g.title}'s goal change`}
                onClick={() => void discard(g)}
              >
                Discard
              </Button>
            )}
            {canSign && (
              // A disabled button shows no tooltip in every browser: the wrapper carries it.
              <span title={reason ?? undefined}>
                <Button
                  sm
                  disabled={busy || done || reason !== null}
                  loading={phase.kind === "sending" && phase.rfpId === g.rfpId}
                  aria-label={`Sign ${g.title}'s goal change`}
                  onClick={() => void sign(g)}
                >
                  {done ? "Signed" : "Sign"}
                </Button>
              </span>
            )}
          </TodoRow>
        );
      })}
      <div className="px-4 pb-3 empty:hidden">
        {phase.kind === "failed" && <Status kind="err" className="mt-2">{phase.reason}</Status>}
      </div>
    </div>
  );
}
