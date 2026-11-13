import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Link } from "react-router";
import type { BallotPhase } from "~/lib/vote-flow";
import { cn } from "~/lib/utils";

/** The chain the round's ballots are recorded on: the real vote's, or a test vote's. */
export type VoteChain = "Ethereum" | "Sepolia";
export const etherscanTx = (hash: string, chain: VoteChain = "Sepolia") =>
  `https://${chain === "Ethereum" ? "" : "sepolia."}etherscan.io/tx/${hash}`;

/** Who sends it to the chain: TheDAO's relayer, or the voter's own wallet. */
export type SendRoute = "relay" | "own";

/** Sending a ballot, by either route: sign, send, then mined and checked to be the
 * ballot signed. Each moment has a title and a line, no stepper. The button stays: disabled while waiting, saying for
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
    onBlocked,
  }: {
    phase: BallotPhase;
    /** The route of the send in progress (or the last one). */
    route: SendRoute;
    chain?: VoteChain;
    /** The ballot on screen is the one that counts on the chain. */
    upToDate: boolean;
    /** The ballot can be sent now (something placed, the rules kept, nothing running). */
    canSend: boolean;
    /** The button's text when ready: "Send my ballot", "Resend my ballot". */
    sendLabel: string;
    resultsHref: string;
    onSend: () => void;
    onSelfSend: () => void;
    onRetry: () => void;
    /** Back to the page that shows the ballot that counts (where a send lands). */
    onSeeBallot?: () => void;
    /** The send button, while the ballot can't be sent, hovered (`scroll` false) or
     * tapped (`scroll` true): show why. */
    onBlocked?: (scroll: boolean) => void;
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
      // On the right, alone or after a note.
      className="ml-auto text-dao-green underline-offset-2 hover:underline disabled:text-white/35 disabled:no-underline"
    >
      Send it yourself, from your wallet
    </button>
  );

  let tone: "plain" | "good" | "bad" | "wait" = "plain";
  let title: string | null = null;
  let body: React.ReactNode = null;
  let button: {
    text: string;
    on?: () => void;
    busy?: boolean;
    good?: boolean;
    /** Off because the ballot can't be sent as it is: it still answers, saying why. */
    blocked?: boolean;
  } = {
    text: sendLabel,
  };
  let foot: React.ReactNode = null;
  /** Signing, or waiting for the send to land. */
  const busy = ["signing", "relaying", "waiting"].includes(phase.kind);

  const ready = () => {
    button = { text: sendLabel, on: canSend ? onSend : undefined, blocked: !canSend };
    foot = selfSendLink;
  };

  switch (phase.kind) {
    case "signing":
      title = "Sign the ballot in your wallet";
      body = own
        ? "The first of two requests. It’s a signature, not a payment."
        : "It’s a signature, not a payment. If you decline, nothing is sent.";
      button = { text: "Waiting for your signature…", busy: true };
      foot = <span>Don’t see it? Open your wallet.</span>;
      break;
    case "relaying":
      if (own) {
        title = "Confirm the transaction in your wallet";
        body = "The second request: it sends your signed ballot to Ethereum. You pay the gas.";
        button = { text: "Waiting for you to confirm…", busy: true };
        foot = <span>If you reject it, nothing is sent.</span>;
        break;
      }
    // falls through: TheDAO's relayer sends it too fast to read, so its moment reads as
    // the wait for the chain (with nothing to link yet).
    case "waiting":
      title = `Waiting for ${chain} to record it`;
      body = "Once it’s mined, the site checks it’s the ballot you signed. Usually under a minute.";
      button = { text: `Waiting for ${chain}…`, busy: true };
      foot = phase.kind === "waiting" && (
        <>
          <span>Already sent: it counts once mined, even if you close this page.</span>
          {txLink}
        </>
      );
      break;
    case "late":
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
        title = "Nothing was sent";
        body =
          `${phase.note} Your ballot is as you left it; your earlier one, if any, still counts.`;
        button = { text: sendLabel, on: canSend ? onSend : undefined, blocked: !canSend };
        foot = selfSendLink;
        break;
      }
      if (upToDate) {
        tone = "good";
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
    <div role="status" data-send-tone={tone}>
      {
        // The message above the button grows and shrinks smoothly, so the button glides
        // rather than jumps; while it runs it keeps one height, so it doesn't move at all.
      }
      <Grow>
        {title && (
          <div
            key={phase.kind}
            className={cn(
              "flex items-start gap-3 motion-safe:animate-[notice-in_0.25s_ease-out]",
              // Signing and waiting: the same height (a title, two lines), the button stays put.
              busy && "min-h-[4.5rem]",
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
      </Grow>
      <button
        type="button"
        // A blocked button stays focusable and answers (aria-disabled): a tap scrolls to
        // why, a hover points at it.
        disabled={!button.on && !(button.blocked && onBlocked)}
        aria-disabled={!button.on || undefined}
        onClick={button.on ?? (button.blocked ? () => onBlocked?.(true) : undefined)}
        onPointerEnter={(e) => {
          if (!button.on && button.blocked && e.pointerType === "mouse") onBlocked?.(false);
        }}
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
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-white/50">
          {foot}
        </div>
      )}
    </div>
  );
}

/** Its height follows its content's, with a transition: what's below it moves smoothly.
 * The gap to what follows is inside, so an empty one takes no room. */
function Grow({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      style={{ height }}
      className="overflow-hidden motion-safe:transition-[height] motion-safe:duration-300 motion-safe:ease-out"
    >
      <div ref={inner} className={cn(children ? "pb-3.5" : "")}>{children}</div>
    </div>
  );
}
