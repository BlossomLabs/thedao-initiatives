import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "~/lib/utils";

export default function VoteBox({
  votes,
  myvote,
  canVote,
  connected,
  onVote,
}: {
  votes: number;
  myvote: number;
  canVote: boolean;
  connected: boolean;
  onVote: (dir: "up" | "down") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const cast = (dir: "up" | "down") => {
    if (busy) return;
    setBusy(true);
    onVote(dir).finally(() => setBusy(false));
  };
  const btn = (dir: "up" | "down") =>
    cn(
      "grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-muted transition-all duration-150",
      canVote
        ? "cursor-pointer hover:border-white/[.16] hover:bg-white/[.08] hover:text-white"
        : "cursor-default opacity-40",
      dir === "up" && myvote === 1 &&
        "border-[rgba(92,183,90,.6)] bg-[rgba(92,183,90,.14)] text-dao-green",
      dir === "down" && myvote === -1 &&
        "border-[rgba(255,59,56,.55)] bg-[rgba(255,59,56,.12)] text-dao-red",
    );
  const title = canVote
    ? undefined
    : connected
    ? "Voting needs the ETHSecurity badge or a $20+ donation here"
    : "Connect a wallet to vote";
  return (
    <div className="flex w-10 flex-none flex-col items-center gap-1 pt-0.5">
      <button
        type="button"
        className={btn("up")}
        aria-label="upvote"
        disabled={!canVote || busy}
        title={title}
        onClick={() => cast("up")}
      >
        <ArrowUp className="size-[15px]" strokeWidth={2.4} />
      </button>
      <div
        className={cn(
          "font-inter-tight text-[15px] font-bold tnum text-[#f2f6fa]",
          myvote === 1 && "text-dao-green",
        )}
      >
        {votes}
      </div>
      <button
        type="button"
        className={btn("down")}
        aria-label="downvote"
        disabled={!canVote || busy}
        title={title}
        onClick={() => cast("down")}
      >
        <ArrowDown className="size-[15px]" strokeWidth={2.4} />
      </button>
      {!canVote && (
        <div className="mt-0.5 text-center text-[9.5px] leading-[1.3] text-muted">
          {connected ? "Badge or $20+" : "Connect to vote"}
        </div>
      )}
    </div>
  );
}
