/**
 * Waiting for a round admin: Ready for the ballot (each with Put on the ballot), then
 * Pledges to sign. Neutral white outlines for what waits, the filled green only on the
 * Put on the ballot button. A site admin whose wallet isn't a round admin's sees the
 * same lists without buttons.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";
import { Link } from "react-router";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import TodoSection, { TodoRow } from "~/components/admin/dashboard/TodoSection";
import {
  AwaitingChip,
  LastTryFailed,
  PledgeSendStatus,
  statusWord,
} from "~/components/admin/initiative/Pledges";
import { useRoundAdmin } from "~/hooks/use-round-admin";
import type { ReadyJson, ToSignJson } from "~/lib/api-types";
import { dayTime, plural, shortAddr, usd } from "~/lib/format";
import { VoteEnvironmentContext } from "~/lib/vote-round";
import type { VoteEnvironment } from "../../../../shared/vote/environment";
import { PutOnBallotAction, TxLink } from "./PutOnBallot";
import GoalsToSign from "./GoalsToSign";
import {
  dropLock,
  isSending,
  sentSince,
  takeLock,
  useBallotRuns,
  useLocked,
  useQueueSign,
  useRoundAdminQueue,
  useSending,
  useSentAt,
} from "./round-admin-actions";

/** What signing the item puts on-chain, in a few words: the amounts are the chain's (a
 * received or withdrawn pledge counts 0), with the status when it isn't "pledged". */
export function changeText(x: ToSignJson): string {
  const word = statusWord(x.status);
  const withWord = (t: string) => (word ? `${word}, ${t}` : t);
  switch (x.kind) {
    case "add":
      return `New pledge, ${withWord(usd(x.amountUsd))}`;
    case "edit":
      return withWord(
        x.fromUsd === null || x.fromUsd === x.amountUsd
          ? usd(x.amountUsd)
          : `${usd(x.fromUsd)} → ${usd(x.amountUsd)}`,
      );
    case "remove":
      return "Removal";
    case "record":
      return x.fromUsd === null
        ? `${usd(x.amountUsd)}, not on-chain yet`
        : `${usd(x.fromUsd)} on-chain → ${usd(x.amountUsd)}`;
  }
}

/**
 * The list of pledges waiting for a round admin's signature, with Sign and Sign all for a
 * round admin. `oneInitiative`: the initiative page's short list (no initiative titles).
 */
export function PledgesToSign(
  { items, asOf, oneInitiative = false }: {
    items: ToSignJson[];
    /** When `items` was read (ms): a pledge sent since is out of date in it. */
    asOf: number;
    oneInitiative?: boolean;
  },
) {
  const { isRoundAdmin, loading } = useRoundAdmin();
  const canSign = !loading && isRoundAdmin;
  const { sign, phase, refresh } = useQueueSign();
  const sending = useSending();
  const locked = useLocked();
  useSentAt();
  const [all, setAll] = useState(false);
  const qc = useQueryClient();
  const [discardError, setDiscardError] = useState("");
  /** Any site admin can drop an awaiting request (the pledge row is untouched). */
  const discard = async (x: ToSignJson) => {
    setDiscardError("");
    try {
      await api(`/api/admin/initiatives/${x.rfpId}/pledge-requests/${x.pid}`, {
        method: "DELETE",
      });
    } catch (e) {
      setDiscardError(e instanceof Error ? e.message : String(e));
    } finally {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    }
  };
  /** Sent, being sent, or sent since the list was read: never signed (again) from here. */
  const stale = (x: ToSignJson) => !!x.inFlight || isSending(x.pid) || sentSince(x.pid, asOf);
  /** One signing at a time on the whole page (one nonce): see `takeLock`. */
  const signOne = async (x: ToSignJson) => {
    if (stale(x) || !takeLock("sign")) return;
    try {
      await sign(x);
    } finally {
      dropLock("sign");
      refresh();
    }
  };
  const signAll = async () => {
    if (!takeLock("sign-all")) return;
    setAll(true);
    try {
      for (const x of items) {
        // Read afresh for each: what was sent since the click is skipped.
        if (stale(x)) continue;
        if ((await sign(x)).kind === "failed") break;
      }
    } finally {
      setAll(false);
      dropLock("sign-all");
      refresh();
    }
  };
  return (
    <div>
      {items.map((x) => (
        <TodoRow key={`${x.rfpId}:${x.pid}`}>
          <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-0.5">
            <span className="font-inter-tight text-[14px] font-medium">
              {x.company}
              {!oneInitiative && (
                <>
                  {" · "}
                  <Link to={`/admin/initiatives/${x.rfpId}`}>{x.title}</Link>
                </>
              )}
            </span>
            <span className="small flex flex-wrap items-center gap-x-2 gap-y-1 text-white/75">
              <span>{changeText(x)}</span>
              {x.by && <AwaitingChip />}
              {x.by && x.at !== null && (
                <span className="dim">asked by {shortAddr(x.by)}, {dayTime(x.at)}</span>
              )}
              {x.inFlight && (
                <span className="dim">
                  Recording on-chain… {x.inFlight.hash && <TxLink hash={x.inFlight.hash} />}
                </span>
              )}
              {x.lastError && <LastTryFailed reason={x.lastError} />}
            </span>
          </div>
          {x.by && (
            <Button
              sm
              variant="ghost"
              disabled={!!x.inFlight || sending.has(x.pid)}
              aria-label={`Discard ${x.company}'s awaiting pledge`}
              onClick={() => void discard(x)}
            >
              Discard
            </Button>
          )}
          {canSign && (
            <Button
              sm
              disabled={locked || stale(x)}
              loading={sending.has(x.pid)}
              aria-label={`Sign ${x.company}'s pledge`}
              onClick={() => void signOne(x)}
            >
              Sign
            </Button>
          )}
        </TodoRow>
      ))}
      {canSign && (
        <div className="flex flex-wrap items-center gap-3 border-t border-white/[.07] px-4 py-3">
          <Button
            sm
            variant="primary"
            disabled={locked}
            loading={all}
            onClick={() => void signAll()}
          >
            Sign all
          </Button>
          <span className="small dim">One signature per pledge. It's not a payment.</span>
        </div>
      )}
      <div className="px-4 pb-3 empty:hidden">
        <PledgeSendStatus phase={phase} />
        {phase.kind === "failed" && <Status kind="err" className="mt-2">{phase.reason}</Status>}
        {discardError && <Status kind="err" className="mt-2">{discardError}</Status>}
      </div>
    </div>
  );
}

function ReadyRow({ r }: { r: ReadyJson }) {
  const pledged = r.pledges.reduce((n, p) => n + p.amountUsd, 0);
  return (
    <TodoRow>
      <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-0.5">
        <Link
          to={`/admin/initiatives/${r.id}`}
          className="font-inter-tight text-[14px] font-medium"
        >
          {r.title}
        </Link>
        <span className="small text-white/75">
          Goal {usd(r.goalUsd)} ·{" "}
          {r.pledges.length
            ? `${plural(r.pledges.length, "pledge")}, ${usd(pledged)}`
            : "no pledges"}
        </span>
      </div>
      <div className="w-full">
        <PutOnBallotAction ready={r} />
      </div>
    </TodoRow>
  );
}

const SubHead = ({ children }: { children: React.ReactNode }) => (
  <h3 className="m-0 border-t border-white/[.07] px-4 pb-1 pt-3 font-inter-tight text-[12px] font-semibold uppercase tracking-[.4px] text-white/60">
    {children}
  </h3>
);

function Queue({ env, title }: { env: VoteEnvironment; title: string }) {
  const q = useRoundAdminQueue(env);
  const runs = useBallotRuns(env);
  if (q.error) {
    return (
      <TodoSection title={title} count="!" empty="">
        <p className="m-0 border-t border-white/[.07] px-4 py-3 small text-[#ffb3b1]">
          {q.error instanceof Error ? q.error.message : String(q.error)}
        </p>
      </TodoSection>
    );
  }
  if (!q.data) return null;
  // One the round already holds isn't listed (the API never sends it).
  const ready = q.data.ready.filter((r) => r.blocker?.kind !== "already");
  // One put on the ballot just now stays until the page leaves, with how it went.
  const started = runs.map((r) => r.ready).filter((r) => !ready.some((x) => x.slug === r.slug));
  const rows = [...ready, ...started];
  const toSign = q.data.toSign;
  const goals = q.data.goals ?? [];
  return (
    <TodoSection
      title={title}
      count={ready.length + toSign.length + goals.length}
      empty="Nothing waits for a round admin."
    >
      {rows.length > 0 && (
        <>
          {env === "production" && <SubHead>Ready for the ballot</SubHead>}
          {rows.map((r) => <ReadyRow key={r.slug} r={r} />)}
        </>
      )}
      {toSign.length > 0 && (
        <>
          <SubHead>Pledges to sign</SubHead>
          <PledgesToSign items={toSign} asOf={q.dataUpdatedAt} />
        </>
      )}
      {goals.length > 0 && (
        <>
          <SubHead>Goal changes to sign</SubHead>
          <GoalsToSign items={goals} />
        </>
      )}
    </TodoSection>
  );
}

/**
 * Waiting for a round admin, for the round of `env` (production: the real round; test:
 * Admin → Test vote's). `title` heads it: "Waiting for a round admin", or "Ready for the
 * test ballot" on the test vote's page.
 */
export default function RoundAdminQueue(
  { env, title }: { env: VoteEnvironment; title: string },
) {
  return (
    <VoteEnvironmentContext.Provider value={env}>
      <Queue env={env} title={title} />
    </VoteEnvironmentContext.Provider>
  );
}
