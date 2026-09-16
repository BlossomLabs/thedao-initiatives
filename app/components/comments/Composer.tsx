import { useState } from "react";
import { Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useSession } from "~/context/session";
import { useIdentity } from "~/hooks/use-identity";
import ConnectInline from "~/components/wallet/ConnectInline";
import { cn } from "~/lib/utils";
import { nameInput, signedInAs } from "./styles";
import { FormNote, type Note, SubmitButton } from "./FormFeedback";

/** One generic comment box (the MVP dropped type/topic pickers). */
export default function Composer(
  { onPost }: {
    onPost: (
      body: string,
      name: string,
      website: string,
      signedIn: boolean,
    ) => Promise<string | null>;
  },
) {
  const { address, isConnected } = useAccount();
  const { session, requireSession, connecting } = useSession();
  const identity = useIdentity(address);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(0);
  const signedIn = Boolean(
    session && address && session.address.toLowerCase() === address.toLowerCase(),
  );

  async function post() {
    const t = text.trim();
    if (!t) {
      setNote({ text: "Write something first." });
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
      setNote({ text: e instanceof Error ? e.message : "Could not post.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3.5 mt-[26px] flex flex-col rounded-2xl border border-white/10 bg-panel-deep px-5 py-[18px] shadow-qa">
      <div className="mb-3 font-inter-tight text-[15px] font-bold text-[#f2f6fa]">
        Join the discussion
      </div>
      <textarea
        className="min-h-[96px] w-full resize-y rounded-xl border border-white/10 bg-[rgba(9,18,30,.5)] px-4 py-3.5 font-inter-tight text-[14.5px] text-[#f2f6fa] outline-none transition-all duration-150 placeholder:text-muted focus:border-[rgba(92,183,90,.55)] focus:shadow-[0_0_0_3px_rgba(92,183,90,.14)] disabled:cursor-default disabled:opacity-60"
        maxLength={2000}
        placeholder="Add a comment"
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
        {isConnected
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
              maxLength={60}
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
          {(!signedIn || connecting) && <ConnectInline />}
          {isConnected && !connecting && signedIn && (
            <span className={signedInAs}>
              <Wallet className="size-3.5" />
              Signed in as {identity.name}
            </span>
          )}
          <SubmitButton busy={busy} done={posted} onClick={post}>Comment</SubmitButton>
        </div>
      </div>
      <FormNote note={note} className="mt-2" />
    </div>
  );
}
