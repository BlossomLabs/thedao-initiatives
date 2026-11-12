import { useRef } from "react";
import { Check, X } from "lucide-react";
import { Link } from "react-router";
import type { BallotPhase } from "~/lib/vote-flow";
import { cn } from "~/lib/utils";

/** The chain the round's ballots are recorded on: the real vote's, or a test vote's. */
export type VoteChain = "Ethereum" | "Sepolia";
export const etherscanTx = (hash: string, chain: VoteChain = "Sepolia") =>
  `https://${chain === "Ethereum" ? "" : "sepolia."}etherscan.io/tx/${hash}`;

/** Who sends it to the chain: TheDAO's relayer, or the voter's own wallet. */
export type SendRoute = "relay" | "own";

type StepState = "todo" | "on" | "done" | "err" | "ask";
type Step = { label: string; state: StepState };

/** Sending a ballot, in three steps for either route: Sign, Send, Review (mined, then
 * checked to be the ballot signed). The button stays: disabled while waiting, saying for
 * what; at the end, what can be done next. Ends counted, or says why not, with the
 * transaction when there is one. */
export default function BallotStatus(
  {
    phase,
    route,
    chain = "Sepolia",
    upToDate,
    canSend,
    sendLabel,
    resultsHref,
    onSend,
    onSelfSend,
    onRetry,
    onSeeBallot,
  }: {
    phase: BallotPhase;
    /** The route of the send in progress (or the last one). */
    route: SendRoute;
    chain?: VoteChain;
    /** The ballot on screen is the one that counts on the chain. */
    upToDate: boolean;
    /** The ballot can be sent now (something placed, the rules kept, nothing running). */
    canSend: boolean;
    /** The button's text when ready: "Send my ballot", "Place at least one proposal". */
    sendLabel: string;
    resultsHref: string;
    onSend: () => void;
    onSelfSend: () => void;
    onRetry: () => void;
    /** Back to the page that shows the ballot that counts (where a send lands). */
    onSeeBallot?: () => void;
  },
) {
  // Which step was running when it failed: a failure without a transaction was at Sign or
  // at Send, whichever this page saw last; not seen (a fresh page), at Send, where Retry
  // keeps the signature.
  const lastActive = useRef<"signing" | "relaying">("relaying");
  if (phase.kind === "signing" || phase.kind === "relaying") lastActive.current = phase.kind;

  const own = route === "own";
  const tx = "hash" in phase && phase.hash && phase.hash !== "0x" ? phase.hash : undefined;
  const txLink = tx && (
    <a
      href={etherscanTx(tx, chain)}
      target="_blank"
      rel="noreferrer"
      className="tnum text-white/55 hover:text-white"
    >
      {tx.slice(0, 6)}…{tx.slice(-4)} on {chain === "Ethereum" ? "Etherscan" : "Sepolia Etherscan"}
    </a>
  );
  const selfSendLink = (
    <button
      type="button"
      disabled={!canSend}
      onClick={onSelfSend}
      className="text-dao-green underline-offset-2 hover:underline disabled:text-white/35 disabled:no-underline"
    >
      Send it yourself, from your wallet
    </button>
  );

  const steps = (a: StepState, b: StepState, c: StepState, labels?: [string, string, string]) => {
    const [l1, l2, l3] = labels ??
      [a === "done" ? "Signed" : "Sign", b === "done" ? "Sent" : "Send", "Review"];
    return [{ label: l1, state: a }, { label: l2, state: b }, { label: l3, state: c }] as Step[];
  };

  let track: Step[] = [];
  let tone: "plain" | "good" | "bad" | "wait" = "plain";
  let title: string | null = null;
  let body: React.ReactNode = null;
  let button: { text: string; on?: () => void; busy?: boolean; good?: boolean } = {
    text: sendLabel,
  };
  let foot: React.ReactNode = null;

  const ready = () => {
    track = steps("todo", "todo", "todo");
    button = { text: sendLabel, on: canSend ? onSend : undefined };
    foot = (
      <>
        <span>Free: TheDAO pays the gas.</span>
        {selfSendLink}
      </>
    );
  };

  switch (phase.kind) {
    case "signing":
      track = steps("on", "todo", "todo");
      title = "Sign the ballot in your wallet";
      body = own
        ? "The first of two requests. It’s a signature, not a payment."
        : "It’s a signature, not a payment. If you decline, nothing is sent.";
      button = { text: "Waiting for your signature…", busy: true };
      foot = <span>Don’t see it? Open your wallet.</span>;
      break;
    case "relaying":
      track = steps("done", "on", "todo");
      title = own ? "Confirm the transaction in your wallet" : "TheDAO is sending it";
      body = own
        ? "The second request: it sends your signed ballot to Ethereum. You pay the gas."
        : `Your signed ballot goes to ${chain}; TheDAO pays the gas.`;
      button = { text: own ? "Waiting for you to confirm…" : "Sending…", busy: true };
      foot = own && <span>If you reject it, nothing is sent.</span>;
      break;
    case "waiting":
      track = steps("done", "done", "on");
      title = `Waiting for ${chain} to record it`;
      body = "Once it’s mined, the site checks it’s the ballot you signed. Usually under a minute.";
      button = { text: `Waiting for ${chain}…`, busy: true };
      foot = (
        <>
          <span>Already sent: it counts once mined, even if you close this page.</span>
          {txLink}
        </>
      );
      break;
    case "late":
      track = steps("done", "done", "err", ["Signed", "Sent", "After the close"]);
      title = "It landed after voting closed";
      body =
        `${chain} recorded it after the vote had ended, so it doesn’t count. The ballot that counted before is the one in the result.`;
      button = { text: "Voting has closed" };
      foot = (
        <>
          <Link to={resultsHref} className="text-dao-green underline-offset-2 hover:underline">
            See the result
          </Link>
          {txLink}
        </>
      );
      break;
    case "failed": {
      const slow = /too long/i.test(phase.reason);
      if (tx && slow) {
        tone = "wait";
        track = steps("done", "done", "ask", ["Signed", "Sent", "Not mined yet"]);
        title = `${chain} is taking long`;
        body =
          "It was sent but isn’t mined yet, and it may still land. Check before sending again, so it isn’t sent twice.";
        button = { text: "Check again", on: onRetry };
        foot = (
          <>
            <span>Your earlier ballot counts until then.</span>
            {txLink}
          </>
        );
      } else if (tx) {
        tone = "bad";
        track = steps("done", "done", "err", ["Signed", "Sent", "Not counted"]);
        title = `${chain} refused it`;
        body = `${phase.reason} It doesn’t count; your earlier ballot still does.`;
        button = { text: "Retry", on: onRetry };
        foot = (
          <>
            <span>Retry checks the chain first.</span>
            {txLink}
          </>
        );
      } else if (lastActive.current === "relaying") {
        tone = "bad";
        track = steps("done", "err", "todo", ["Signed", "Not sent", "Review"]);
        title = "It never left";
        body = `${
          own ? "It couldn’t be sent" : "TheDAO couldn’t send it"
        }: ${phase.reason} No transaction was made, and your earlier ballot still counts.`;
        button = { text: "Retry", on: onRetry };
        foot = (
          <>
            <span>Retry keeps your signature.</span>
            {canSend && selfSendLink}
          </>
        );
      } else {
        tone = "bad";
        track = steps("err", "todo", "todo", ["Not signed", "Send", "Review"]);
        title = "It couldn’t be signed";
        body = `${phase.reason} Nothing was sent.`;
        button = { text: "Try again", on: canSend ? onSend : undefined };
        foot = canSend && selfSendLink;
      }
      break;
    }
    case "counted":
      if (!upToDate) {
        ready();
        break;
      }
    // falls through: what counts is what's on screen
    case "idle":
      if (phase.kind === "idle" && phase.note) {
        track = steps("err", "todo", "todo", ["Not signed", "Send", "Review"]);
        title = "Nothing was sent";
        body =
          `${phase.note} Your ballot is as you left it; your earlier one, if any, still counts.`;
        button = { text: sendLabel, on: canSend ? onSend : undefined };
        foot = (
          <>
            <span>Free: TheDAO pays the gas.</span>
            {selfSendLink}
          </>
        );
        break;
      }
      if (upToDate) {
        tone = "good";
        track = steps("done", "done", "done", ["Signed", "Sent", "Reviewed"]);
        title = "Your ballot counts";
        body = `Recorded on ${chain}. Change a tier and you can send again, until it settles.`;
        // Where a send lands: the ballot that counts. Without that page, it just counts.
        button = onSeeBallot
          ? { text: "See my ballot", on: onSeeBallot }
          : { text: "Counted", good: true };
        foot = (
          <>
            {!onSeeBallot && (
              <Link to={resultsHref} className="text-dao-green underline-offset-2 hover:underline">
                See the live results
              </Link>
            )}
            {txLink}
          </>
        );
        break;
      }
      ready();
      break;
  }

  return (
    <div className="space-y-3.5" role="status" data-send-tone={tone}>
      <ol
        className="m-0 mb-5 flex list-none items-center gap-2 p-0"
        aria-label="Sending your ballot"
      >
        {track.map((s, i) => (
          <li key={i} className={cn("flex min-w-0 items-center gap-2", i > 0 && "flex-1")}>
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-[1.5px] flex-1",
                  track[i - 1].state === "done" ? "bg-dao-green" : "bg-white/15",
                )}
              />
            )}
            <StepNode n={i + 1} state={s.state} />
            <span
              className={cn(
                "whitespace-nowrap font-inter-tight text-[13px]",
                s.state === "done" && "text-[#a7e3a5]",
                s.state === "on" && "font-semibold text-white",
                s.state === "err" && "font-semibold text-[#f6b394]",
                s.state === "ask" && "font-semibold text-vote",
                s.state === "todo" && "text-white/45",
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      {title && (
        <div
          className={cn(
            "flex items-start gap-3",
            tone === "good" && "rounded-xl border border-dao-green/40 bg-dao-green/[.08] p-3",
            tone === "bad" && "rounded-xl border border-[#f08a5d]/40 bg-[#f08a5d]/[.07] p-3",
            tone === "wait" && "rounded-xl border border-vote/40 bg-vote/[.07] p-3",
          )}
        >
          {tone === "good" && (
            <span className="mt-0.5 flex-none -rotate-[4deg] rounded-lg border-2 border-dao-green bg-dao-green/[.12] px-2 py-0.5 font-inter-tight text-[13px] font-extrabold uppercase tracking-[.14em] text-[#a7e3a5]">
              Counted
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <p className="m-0 font-inter-tight text-[16px] font-semibold text-white">{title}</p>
            <p className="m-0 text-[13.5px] leading-relaxed text-white/72">{body}</p>
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={!button.on}
        onClick={button.on}
        className={cn(
          "flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-3 font-inter-tight text-[15px] font-semibold transition-colors",
          button.on
            ? "bg-[#e5484d] text-white hover:bg-[#d83c41]"
            : button.good
            ? "cursor-default bg-dao-green/[.18] text-[#a7e3a5]"
            : "cursor-not-allowed bg-white/[.08] text-white/70",
        )}
      >
        {button.busy && (
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
          />
        )}
        {button.good && <Check className="size-4" aria-hidden="true" />}
        {button.text}
      </button>
      {foot && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-white/50">
          {foot}
        </div>
      )}
    </div>
  );
}

function StepNode({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[26px] flex-none place-items-center rounded-full font-inter-tight text-[12px] font-bold",
        state === "todo" && "border-[1.5px] border-white/25 text-white/45",
        state === "on" &&
          "border-2 border-dao-green text-[#a7e3a5] motion-safe:animate-[peek-step_1.6s_ease-in-out_infinite]",
        state === "done" && "bg-dao-green text-[#14304a]",
        state === "err" && "bg-[#f08a5d] text-[#2a1408]",
        state === "ask" && "border-2 border-vote text-vote",
      )}
    >
      {state === "done"
        ? <Check className="size-3.5" strokeWidth={3} />
        : state === "err"
        ? <X className="size-3.5" strokeWidth={3} />
        : state === "ask"
        ? "?"
        : n}
    </span>
  );
}
