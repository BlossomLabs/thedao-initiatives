import { useEffect, useRef, useState } from "react";
import { Undo2, Wallet } from "lucide-react";
import { StarInput } from "~/components/ratings/Stars";
import { RATE_HERE } from "~/components/ratings/rate-here";
import { REVIEW_LABEL } from "~/lib/reviewer";
import { useInstant } from "~/components/ui/Reveal";
import type { Stars } from "@shared/ratings";
import { useWallet } from "~/context/wallet";
import { useSession } from "~/context/session";
import { useIdentity } from "~/hooks/use-identity";
import ConnectInline from "~/components/wallet/ConnectInline";
import { cn } from "~/lib/utils";
import { nameInput, signedInAs } from "./styles";
import { FormNote, type Note, SubmitButton } from "./FormFeedback";
import { COMMENT_BODY_MAX, COMMENT_NAME_MAX } from "@shared/comments";
import { inputMax, tooLong } from "@shared/draft/mod";
import { errorMessage } from "~/lib/api";

/**
 * One generic comment box (the MVP dropped type/topic pickers). Voting NFT holders also
 * get stars at the end of the title's line: picking them turns the box into a
 * public review (the text is optional), titled so
 * before anything is sent.
 */
export default function Composer(
  { onPost, onReview }: {
    onPost: (
      body: string,
      name: string,
      website: string,
      signedIn: boolean,
    ) => Promise<string | null>;
    /** Voting NFT holders on a board initiative: post a public review instead. */
    onReview?: (stars: Stars, body: string) => Promise<void>;
  },
) {
  const { address, isConnected } = useWallet();
  const { session, requireSession, connecting } = useSession();
  const identity = useIdentity(address);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(0);
  const [stars, setStars] = useState<Stars | null>(null);
  const review = Boolean(onReview && stars);
  const box = useRef<HTMLDivElement>(null);
  // Bumped to replay the stars' outline: "pick here".
  const [nudge, setNudge] = useState(0);
  const instant = useInstant();
  // The side card's Rate it (and a #reviews link) scroll here smoothly; once there,
  // the stars take the focus and a yellow outline goes around them once.
  useEffect(() => {
    if (!onReview) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      const el = box.current;
      if (!el) return;
      clearTimeout(timer);
      const arrive = () => {
        globalThis.removeEventListener("scrollend", arrive);
        clearTimeout(timer);
        el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus({
          preventScroll: true,
        });
        setNudge((n) => n + 1);
      };
      el.scrollIntoView?.({ block: "center", behavior: instant ? "auto" : "smooth" });
      // No scrollend when it is already in place (or the browser lacks it).
      globalThis.addEventListener("scrollend", arrive);
      timer = setTimeout(arrive, instant ? 0 : 900);
    };
    if (location.hash === "#reviews") go();
    globalThis.addEventListener(RATE_HERE, go);
    return () => {
      globalThis.removeEventListener(RATE_HERE, go);
      clearTimeout(timer);
    };
  }, [Boolean(onReview), instant]); // eslint-disable-line react-hooks/exhaustive-deps -- once it can review
  const signedIn = Boolean(
    session && address && session.address.toLowerCase() === address.toLowerCase(),
  );

  async function post() {
    const t = text.trim();
    if (review) {
      if (t.length > COMMENT_BODY_MAX) {
        setNote({ text: tooLong("The review", COMMENT_BODY_MAX) });
        return;
      }
      setBusy(true);
      setNote(null);
      try {
        await onReview!(stars!, t);
        setText("");
        setStars(null);
        setPosted((n) => n + 1);
        setNote({ text: "Review saved. Your latest review is your voting badge’s rating.", ok: true });
      } catch (e) {
        setNote({ text: errorMessage(e, "Could not save the review."), ok: false });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!t) {
      setNote({ text: "Write something first." });
      return;
    }
    if (t.length > COMMENT_BODY_MAX) {
      setNote({ text: tooLong("The comment", COMMENT_BODY_MAX) });
      return;
    }
    if (name.trim().length > COMMENT_NAME_MAX) {
      setNote({ text: tooLong("The name", COMMENT_NAME_MAX) });
      return;
    }
    let useSession = signedIn;
    if (isConnected && !signedIn) {
      try {
        await requireSession();
        useSession = true;
      } catch {
        setNote({
          text: "Signature was cancelled. Post with just a name instead, or try signing again.",
        });
        return;
      }
    }
    if (!useSession && !name.trim()) {
      setNote({ text: "Add your name, or connect a wallet." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const msg = await onPost(t, name.trim(), website, useSession);
      setText("");
      setPosted((n) => n + 1);
      if (msg) setNote({ text: msg, ok: true });
    } catch (e) {
      setNote({ text: errorMessage(e, "Could not post."), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={box}
      id={onReview ? "reviews" : undefined}
      className={cn(
        "mb-3.5 mt-[26px] flex scroll-mt-24 flex-col rounded-2xl border border-white/10 bg-panel-deep px-5 py-[18px] shadow-qa transition-colors",
        review && "border-[rgba(240,180,41,.55)]",
      )}
    >
      {/* The title, and for admins the stars at the end of its line. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="font-inter-tight text-[15px] font-bold text-[#f2f6fa]">
          {review ? REVIEW_LABEL : "Join the discussion"}
        </div>
        {onReview && (
          <span className="inline-flex items-center gap-0.5">
            {
              /* The way back to a comment, the text kept (as clicking the picked star again):
                left of the stars, so they stay lined up with the box's edge, and its room
                kept while hidden, so they never shift. */
            }
            <button
              type="button"
              onClick={() => setStars(null)}
              disabled={busy || !stars}
              // Beside the stars "Undo" is enough; read out, it says what it undoes.
              aria-label="Undo rating"
              aria-hidden={!stars}
              tabIndex={stars ? 0 : -1}
              className={cn(
                "mr-1 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-edge2 bg-white/5 px-2.5 font-inter-tight text-[12px] font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-dao-bright disabled:cursor-default",
                !stars && "invisible",
              )}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              Undo
            </button>
            {/* After Rate it, the arrow draws in first and the stars' outlines follow. */}
            <span
              className="relative inline-flex"
              style={nudge ? { "--ring-delay": "700ms" } as React.CSSProperties : undefined}
            >
              {nudge > 0 && <HandArrow key={nudge} />}
              <StarInput
                value={stars}
                onChange={setStars}
                label="Your rating"
                disabled={busy}
                nudge={nudge}
              />
            </span>
          </span>
        )}
      </div>
      <textarea
        className="min-h-[96px] w-full resize-y rounded-xl border border-white/10 bg-[rgba(9,18,30,.5)] px-4 py-3.5 font-inter-tight text-[14.5px] text-[#f2f6fa] outline-none transition-all duration-150 placeholder:text-muted focus:border-[rgba(92,183,90,.55)] focus:shadow-[0_0_0_3px_rgba(92,183,90,.14)] disabled:cursor-default disabled:opacity-60"
        maxLength={inputMax(COMMENT_BODY_MAX)}
        placeholder={review ? "Why this rating? (optional)" : "Add a comment"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <input
        name="website"
        className="hp"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        aria-hidden="true"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5">
        {review ? <span /> : isConnected
          ? (
            <span className="text-[12px] text-muted">
              {signedIn
                ? "Posting as a verified participant."
                : "Sign in with your wallet to post as a verified participant."}
            </span>
          )
          : (
            <input
              className={cn(nameInput, "w-auto min-w-[200px] flex-1")}
              maxLength={inputMax(COMMENT_NAME_MAX)}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          )}
        <div className="flex flex-wrap items-center gap-2.5">
          {
            /* Kept mounted while connecting: the wallet is briefly connected before
              the signature, and the button must survive to show a refusal. */
          }
          {!review && (!signedIn || connecting) && <ConnectInline />}
          {!review && isConnected && !connecting && signedIn && (
            <span className={signedInAs}>
              <Wallet className="size-3.5" />
              Signed in as {identity.name}
            </span>
          )}
          <SubmitButton busy={busy} done={posted} onClick={post}>
            {review ? "Post review" : "Comment"}
          </SubmitButton>
        </div>
      </div>
      <FormNote note={note} className="mt-2" />
    </div>
  );
}

/** A hand-drawn arrow coming down from above at a slant and turning right into the
 * stars (its tip level with their middle), each line gone over twice like a
 * pen sketch: it draws itself, then fades. With reduced motion it is simply
 * there, then fades. */
function HandArrow() {
  // [path, when it starts drawing], each line then its second pass: the stroke, then the
  // head's upper side, then its lower one.
  const lines: [string, string][] = [
    // Leaving at 60° below the horizontal, level by the tip.
    ["M14 6c10 17.3 30 32 52 32", "0ms"],
    ["M15.5 5.2c10.5 17 29.5 31.5 50 32.2", "120ms"],
    ["M66 38l-12-9", "380ms"],
    ["M64.8 37.3l-10.4-8.4", "420ms"],
    ["M66 38l-12.5 7.5", "520ms"],
    ["M65.2 38.9l-11.4 6.2", "560ms"],
  ];
  return (
    <svg
      viewBox="0 0 72 48"
      className="pointer-events-none absolute right-full top-1/2 mr-0.5 h-12 w-[72px] -translate-y-[38px] animate-arrow-fade text-dao-amber"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {lines.map(([d, delay], i) => (
        <path
          key={i}
          d={d}
          // The second passes thinner and fainter, as a pen going back over a line.
          // The head (from the third line on) heavier still, so it reads at its short length.
          strokeWidth={(i % 2 ? 2.2 : 3) + (i > 1 ? 1 : 0)}
          opacity={i % 2 ? 0.7 : 1}
          pathLength={1}
          // A gap longer than the line: the next dash's round cap would dot its end early.
          strokeDasharray="1 2"
          // The head's short sides go quicker than the long stroke.
          style={{ animationDelay: delay, animationDuration: i > 1 ? "0.18s" : undefined }}
          className="animate-arrow-draw motion-reduce:animate-none"
        />
      ))}
    </svg>
  );
}
