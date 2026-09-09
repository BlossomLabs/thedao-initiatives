import { useState } from "react";
import { Send, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useSession } from "~/context/session";
import { useIdentity } from "~/hooks/use-identity";
import { cn } from "~/lib/utils";

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
  const { session, requireSession, signingIn } = useSession();
  const identity = useIdentity(address);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(
    session && address && session.address.toLowerCase() === address.toLowerCase(),
  );

  async function post() {
    const t = text.trim();
    if (!t) {
      setNote("Write something first.");
      return;
    }
    let useSession = signedIn;
    if (isConnected && !signedIn) {
      try {
        await requireSession();
        useSession = true;
      } catch {
        setNote("Signature was cancelled. Post with just a name instead, or try signing again.");
        return;
      }
    }
    if (!useSession && !name.trim()) {
      setNote("Add your name, or connect a wallet.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const msg = await onPost(t, name.trim(), website, useSession);
      setText("");
      if (msg) setNote(msg);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not post.");
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
        className="min-h-[96px] w-full resize-y rounded-xl border border-white/10 bg-[rgba(9,18,30,.5)] px-4 py-3.5 font-inter-tight text-[14.5px] text-[#f2f6fa] outline-none transition-all duration-150 placeholder:text-muted focus:border-[rgba(92,183,90,.55)] focus:shadow-[0_0_0_3px_rgba(92,183,90,.14)]"
        maxLength={2000}
        placeholder="Add a comment"
        value={text}
        onChange={(e) => setText(e.target.value)}
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
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        {isConnected
          ? (
            <span className="text-[12px] text-muted">
              {signedIn
                ? "Posting as a verified participant."
                : "Connect your wallet to post as a verified participant."}
            </span>
          )
          : (
            <input
              className="rounded-[9px] border border-white/10 bg-[rgba(9,18,30,.5)] px-3 py-[9px] font-inter-tight text-[13.5px] text-white outline-none placeholder:text-muted"
              maxLength={60}
              placeholder="Your name (required without a wallet)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        <div className="flex items-center gap-2.5">
          {isConnected && (
            <button
              type="button"
              className={cn(
                "inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-[rgba(126,179,255,.35)] bg-[rgba(44,94,134,.2)] px-3.5 py-2 font-inter-tight text-[13px] font-semibold text-dao-rfp transition-all duration-150 hover:border-[rgba(126,179,255,.6)] hover:bg-[rgba(44,94,134,.45)] hover:text-white",
              )}
              onClick={() => void requireSession().catch(() => {})}
              disabled={signedIn || signingIn}
            >
              <Wallet className="size-3.5" />
              {signedIn
                ? `Signed in as ${identity.name}`
                : signingIn
                ? "Check your wallet…"
                : "Connect & sign"}
            </button>
          )}
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-dao-green bg-dao-green px-5 py-[9px] font-inter-tight text-[13px] font-bold text-[#0d1f14] transition-all duration-150 hover:border-[#6cc96a] hover:bg-[#6cc96a] hover:shadow-[0_0_16px_rgba(0,255,136,.28)] disabled:cursor-default disabled:opacity-60 disabled:shadow-none"
            disabled={busy}
            onClick={post}
          >
            <Send className="size-3.5" />Comment
          </button>
        </div>
      </div>
      {note && <p className="m-0 mt-2 min-h-[1em] text-[13px] text-dao-red">{note}</p>}
    </div>
  );
}
