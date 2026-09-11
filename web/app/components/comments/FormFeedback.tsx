import { useEffect, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { cn } from "~/lib/utils";
import { submitBtn } from "./styles";

/** A status line under a form: red for problems, green for confirmations. */
export type Note = { text: string; ok?: boolean } | null;

export function FormNote({ note, className }: { note: Note; className?: string }) {
  if (!note) return null;
  return (
    <p
      key={note.text}
      role="status"
      className={cn(
        "m-0 animate-in fade-in slide-in-from-top-1 text-[13px] duration-200",
        note.ok ? "text-dao-green" : "text-dao-red",
        className,
      )}
    >
      {note.text}
    </p>
  );
}

/** How long the "Posted" check mark stays on a submit button. */
export const SENT_MS = 1600;

/**
 * Green submit button that reacts to a click: a spinner while the request is
 * out, then a check mark for a moment once it lands.
 */
export function SubmitButton(
  { busy, done, children, onClick }: {
    busy: boolean;
    /** Bump this to flash the "sent" state (e.g. a counter of successes). */
    done: number;
    children: string;
    onClick: () => void;
  },
) {
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!done) return;
    setSent(true);
    const t = setTimeout(() => setSent(false), SENT_MS);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={cn(submitBtn, sent && "border-[#6cc96a] bg-[#6cc96a]")}
      disabled={busy || sent}
      aria-busy={busy}
      onClick={onClick}
    >
      {busy
        ? <Loader2 className="size-3.5 animate-spin" />
        : sent
        ? <Check className="size-3.5 animate-in zoom-in-50 duration-200" />
        : <Send className="size-3.5" />}
      {busy ? "Posting…" : sent ? "Posted" : children}
    </button>
  );
}
