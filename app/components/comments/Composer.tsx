import { useEffect, useRef, useState } from "react";
import { Lock, Wallet } from "lucide-react";
import { StarInput } from "~/components/ratings/Stars";
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
 * One generic comment box (the MVP dropped type/topic pickers). Admins also
 * get a star row: picking stars turns the box into a private review (only
 * admins see it, the text is optional), and says so before anything is sent.
 */
export default function Composer(
  { onPost, onReview }: {
    onPost: (
      body: string,
      name: string,
      website: string,
      signedIn: boolean,
    ) => Promise<string | null>;
    /** Admins on a board initiative: post a private review instead. */
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
  // The board's rating chips link here (#reviews).
  useEffect(() => {
    if (onReview && location.hash === "#reviews") {
      box.current?.scrollIntoView({ block: "center" });
    }
  }, [Boolean(onReview)]); // eslint-disable-line react-hooks/exhaustive-deps -- once it can review
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
        setNote({ text: "Review saved. Your latest review is your rating.", ok: true });
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
      <div className="mb-3 font-inter-tight text-[15px] font-bold text-[#f2f6fa]">
        {review ? "Private review" : "Join the discussion"}
      </div>
      {onReview && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StarInput
            value={stars}
            onChange={setStars}
            label="Private rating (only admins)"
            disabled={busy}
          />
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <Lock className={cn("size-3", review && "text-dao-amber")} aria-hidden="true" />
            {review
              ? "Only admins will see this review. The text is optional."
              : "Pick stars to rate privately (only admins)."}
          </span>
        </div>
      )}
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
            {review ? "Post private review" : "Comment"}
          </SubmitButton>
        </div>
      </div>
      <FormNote note={note} className="mt-2" />
    </div>
  );
}
