/** Put on the ballot: the admin initiative page's card, and the button a Ready for the
 * ballot row carries. Only a round admin's wallet gets the button; a site admin without
 * the round's roles is told a round admin does it. Green, filled: On the ballot's colour,
 * never the vote's gold (that means settled). */
import { Check } from "lucide-react";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { explorerTx } from "~/components/vote/BallotStatus";
import { chainName } from "~/components/admin/initiative/Pledges";
import { useRoundAdmin } from "~/hooks/use-round-admin";
import type { ReadyJson } from "~/lib/api-types";
import { type BallotPhase, blockerText } from "~/lib/ballot-add";
import { clock, plural, shortAddr, usd } from "~/lib/format";
import { useWallet } from "~/context/wallet";
import { useRound } from "~/lib/vote-round";
import { cn } from "~/lib/utils";
import { addPlan } from "../../../../shared/vote/add-plan";
import { cardOf, useLocked, usePutOnBallot } from "./round-admin-actions";

/** The filled green of On the ballot, with its dark text. */
export const BALLOT_GREEN =
  "border-dao-green bg-dao-green text-[#08321c] hover:border-dao-green hover:bg-dao-green";

/** "On the ballot", as the admin initiative page's header shows it. */
export function OnBallotChip() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-dao-green px-2.5 py-0.5 font-inter-tight text-[11.5px] font-semibold text-[#08321c]">
      <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      On the ballot
    </span>
  );
}

export const SITE_ADMIN_NOTE = "Qualified. A round admin puts it on the ballot.";

const pledgedOf = (r: ReadyJson) => r.pledges.reduce((n, p) => n + p.amountUsd, 0);

/** How many transactions adding it takes (new affiliations first). */
function txCount(round: ReturnType<typeof useRound>, r: ReadyJson): number {
  try {
    return addPlan(round, [cardOf(r)]).calls.length;
  } catch {
    return 1;
  }
}

/** "Your wallet asks N times: …", for this initiative's transactions and pledges. */
export function asksText(txs: number, pledges: number): string {
  const total = txs + pledges;
  const adds = txs === 1 ? "the transaction that adds it" : `the ${txs} transactions that add it`;
  const times = total === 1 ? "once" : `${total} times`;
  return pledges
    ? `Your wallet asks ${times}: ${adds}, then one signature per pledge.`
    : `Your wallet asks ${times}: ${adds}.`;
}

export function TxLink({ hash }: { hash: string }) {
  const chain = chainName(useRound());
  return (
    <a
      href={explorerTx(hash, chain)}
      target="_blank"
      rel="noreferrer"
      // Without contextual alternates the font draws 0x as 0×.
      className="[font-feature-settings:'calt'_0]"
    >
      {hash.slice(0, 6)}…{hash.slice(-4)} on {chain}
    </a>
  );
}

function Line({ done, children }: { done?: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", !done && "dim")}>
      {done && <Check className="size-3.5 shrink-0 text-dao-green" aria-label="done" />}
      {children}
    </li>
  );
}

/** Where Put on the ballot stands, a line per step, as on the canvas. */
export function BallotProgress(
  { phase, ready, hash, signed, already = false }: {
    phase: BallotPhase;
    ready: ReadyJson;
    /** The last transaction sent. */
    hash: string | null;
    /** How many pledges were signed. */
    signed: number;
    /** Another admin's add landed first. */
    already?: boolean;
  },
) {
  const added = phase.kind !== "adding" && !(phase.kind === "failed" && !phase.added);
  const signing = phase.kind === "signing" ? phase.done : -1;
  return (
    <div className="mt-3">
      <ul className="small m-0 flex list-none flex-col gap-1.5 p-0" role="status">
        {!added && phase.kind === "adding" && (
          <Line>
            Adding it to the round…{phase.of > 1 && ` (${phase.step} of ${phase.of})`}
            {phase.hash && <TxLink hash={phase.hash} />}
          </Line>
        )}
        {added && already && <Line done>Another admin already added it.</Line>}
        {added && !already && (
          <Line done>
            Added to the round
            {hash && <TxLink hash={hash} />}
          </Line>
        )}
        {phase.kind === "waiting-round" && <Line>Waiting for the site to see it…</Line>}
        {ready.pledges.map((p, i) =>
          i < signed
            ? <Line key={p.pid} done>Recorded {p.company} {usd(p.amountUsd)}</Line>
            : i === signing
            ? (
              <Line key={p.pid}>
                Recording {p.company} {usd(p.amountUsd)} ({i + 1} of{" "}
                {ready.pledges.length}): sign it in your wallet. It's a signature, not a payment.
              </Line>
            )
            : null
        )}
        {phase.kind === "done" && <Line done>On the ballot.</Line>}
      </ul>
      {phase.kind === "failed" && <Status kind="err" className="mt-2.5">{phase.reason}</Status>}
    </div>
  );
}

/**
 * The button, its blocker and its progress; a site admin who isn't a round admin gets the
 * note instead. Nothing while the wallet's roles are being read.
 */
export function PutOnBallotAction(
  { ready, asks = false }: {
    ready: ReadyJson; /** Say how often the wallet asks. */
    asks?: boolean;
  },
) {
  const ROUND = useRound();
  const { isRoundAdmin, loading } = useRoundAdmin();
  const { start, run, busy } = usePutOnBallot(ready);
  const wallet = useWallet();
  // Something is being signed or put on the ballot: one wallet request at a time.
  const locked = useLocked();
  if (loading) return null;
  if (!isRoundAdmin) return <p className="small dim m-0">{SITE_ADMIN_NOTE}</p>;
  const phase = run?.phase;
  // Once it is added, the round lists it: what blocks it now is its being there.
  const reason = run ? null : blockerText(ready.blocker);
  // Another round admin is putting it on the ballot (their own claim, e.g. after a reload,
  // leaves the button to them).
  const claim = ready.claim;
  const claimedBy = !run && claim &&
      claim.by.toLowerCase() !== (wallet.address ?? "").toLowerCase()
    ? `${shortAddr(claim.by)} is putting it on the ballot (since ${clock(claim.at)}).`
    : null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          sm
          className={BALLOT_GREEN}
          disabled={locked || reason !== null || claimedBy !== null ||
            (!!phase && (phase.kind !== "failed" || phase.added))}
          loading={busy}
          title={reason ?? undefined}
          onClick={() => void start()}
        >
          Put on the ballot
        </Button>
        {reason && <span className="small dim">{reason}</span>}
        {!reason && claimedBy && <span className="small dim">{claimedBy}</span>}
      </div>
      {asks && !reason && !claimedBy && !phase && (
        <p className="small dim m-0 mt-2.5">
          {asksText(txCount(ROUND, ready), ready.pledges.length)}
        </p>
      )}
      {run && (
        <BallotProgress
          phase={run.phase}
          ready={ready}
          hash={run.hash}
          signed={run.signed}
          already={run.already}
        />
      )}
    </div>
  );
}

/** The admin initiative page's card, for an initiative Ready for the ballot. */
export default function PutOnBallotCard({ ready }: { ready: ReadyJson }) {
  const pledged = pledgedOf(ready);
  const rows: [string, React.ReactNode][] = [
    [
      "Safe",
      ready.safeAddress
        ? <span key="safe" className="mono">{shortAddr(ready.safeAddress)}</span>
        : "None",
    ],
    ["Goal", usd(ready.goalUsd)],
    [
      "Pledges it signs",
      ready.pledges.length ? `${plural(ready.pledges.length, "pledge")}, ${usd(pledged)}` : "None",
    ],
    ["Asks the pool", usd(Math.max(0, ready.goalUsd - pledged))],
    ["Affiliations", ready.affiliations.length ? ready.affiliations.join(", ") : "None"],
    ["RFP", ready.type === "rfp" ? "Yes" : "No"],
  ];
  return (
    <div className="panel">
      <span className="k">Put on the ballot</span>
      <p className="small m-0 mb-3">
        Sends it to the vote contract with its pledges, so voters can place it in a tier.
      </p>
      <dl className="small m-0 mb-3.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="dim">{k}</dt>
            <dd className="m-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <PutOnBallotAction ready={ready} asks />
    </div>
  );
}
