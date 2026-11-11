import { Link } from "react-router";
import { Button } from "~/components/ui/Button";
import type { BallotPhase } from "~/lib/vote-flow";

export const etherscanTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

function TxLink({ hash }: { hash?: string }) {
  if (!hash || hash === "0x") return null;
  return (
    <a
      href={etherscanTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="text-[12.5px] text-white/50 underline underline-offset-2"
    >
      See it on Sepolia Etherscan
    </a>
  );
}

/** Where the last ballot stands: on its way, counted, or failed with Retry. */
export default function BallotStatus({ phase, onRetry, selfSend }: {
  phase: BallotPhase;
  onRetry: () => void;
  /** "Send it yourself", offered next to Retry (Task 8). */
  selfSend?: React.ReactNode;
}) {
  switch (phase.kind) {
    case "idle":
      return phase.note ? <p className="text-[13.5px] text-white/60">{phase.note}</p> : null;
    case "signing":
      return <p className="text-[14px] text-white/70">Sign the ballot in your wallet…</p>;
    case "relaying":
      return <p className="text-[14px] text-white/70">Sending your ballot…</p>;
    case "waiting":
      return (
        <div className="space-y-1" role="status">
          <p className="text-[14px] text-white/80">Recording your ballot on Sepolia…</p>
          <TxLink hash={phase.hash} />
        </div>
      );
    case "counted":
      return (
        <div
          className="space-y-2 rounded-xl border border-dao-green/40 bg-dao-green/10 p-4"
          role="status"
        >
          <p className="text-[15px] font-semibold text-white">
            Counted ✓ You can change it until voting closes.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/vote" className="text-[14px] text-dao-green underline underline-offset-2">
              See the live results
            </Link>
            <TxLink hash={phase.hash} />
          </div>
        </div>
      );
    case "late":
      return (
        <div className="space-y-1 rounded-xl border border-white/15 p-4" role="status">
          <p className="text-[14px] text-white/80">
            Voting had closed when this landed, so it doesn't count.
          </p>
          <TxLink hash={phase.hash} />
        </div>
      );
    case "failed":
      return (
        <div
          className="space-y-3 rounded-xl border border-red-400/40 bg-red-400/10 p-4"
          role="alert"
        >
          <p className="text-[14px] text-white">
            <b>Didn't go through.</b> {phase.reason}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={onRetry}>Retry</Button>
            {selfSend}
          </div>
          <TxLink hash={phase.hash} />
        </div>
      );
  }
}
