import { useEffect, useState } from "react";
import { Bot, Copy, Link2, ListOrdered } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Dialog";
import { cn } from "~/lib/utils";
import type { Tier } from "../../../shared/vote/ballot";
import { formatBallotPb, parseBallotText } from "../../../shared/vote/pb";

const LLMS = "/vote/llms.txt";

/** A short "Copied." that clears itself, or why the copy failed. */
function useFlash(): [string | undefined, (s: string) => void] {
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(undefined), 1500);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg];
}

/** What to give the LLM, as a row: an icon, what it is, and its copy button (an icon
 * button on a phone). */
function GiveRow(
  { icon, title, note, button, copyLabel, onCopy, flash, disabled }: {
    icon: React.ReactNode;
    title: React.ReactNode;
    note: React.ReactNode;
    /** The copy button's words on wider screens ("Copy link", "Copy"). */
    button: string;
    /** Its accessible name ("Copy the guide's link"). */
    copyLabel: string;
    onCopy: () => void;
    flash?: string;
    disabled?: boolean;
  },
) {
  const failed = flash && flash !== "Copied.";
  return (
    <li className="flex items-center gap-3 py-3 pl-3.5 pr-3 max-sm:gap-2.5 max-sm:py-2.5 max-sm:pl-3 max-sm:pr-2.5">
      <span
        aria-hidden="true"
        className="grid size-8 flex-none place-items-center rounded-[10px] bg-white/[.06] text-white/80 max-sm:hidden"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="m-0 font-inter-tight text-[14px] font-medium text-white">{title}</p>
        <p
          className={cn("m-0 truncate text-[12.5px]", failed ? "text-amber-200" : "text-white/55")}
        >
          {failed ? flash : note}
        </p>
      </div>
      <Button
        sm
        disabled={disabled}
        aria-label={copyLabel}
        onClick={onCopy}
        className="flex-none px-4 max-sm:size-11 max-sm:p-0"
      >
        <Copy className="size-3.5 max-sm:size-4" aria-hidden="true" />
        <span className="max-sm:hidden">{flash === "Copied." ? "Copied" : button}</span>
      </Button>
    </li>
  );
}

/** "Use an LLM…": a button by the ballot that opens what an LLM needs to draft this
 * ballot (the /vote/llms.txt guide, and this ballot to start from, both to copy) and
 * where to paste its answer back (pabutools, Blossom ties). Pasting only replaces the
 * draft; nothing is sent. */
export default function BallotMenu({ slugs, titles, askUsd, tiers, onApply }: {
  slugs: string[];
  titles: (slug: string) => string;
  askUsd: (slug: string) => bigint;
  tiers: Partial<Record<string, Tier>>;
  /** Replaces the draft; true when settled tiers were kept as counted. */
  onApply: (tiers: Partial<Record<string, Tier>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  /** After a paste that kept the settled tiers: said in the dialog. */
  const [kept, setKept] = useState(false);
  const [linkCopied, flashLink] = useFlash();
  const [ballotCopied, flashBallot] = useFlash();

  const llmsUrl = typeof location === "undefined" ? LLMS : `${location.origin}${LLMS}`;
  const placed = Object.keys(tiers).length;
  const tierCount = new Set(Object.values(tiers)).size;

  const show = () => {
    setText("");
    setError(undefined);
    setKept(false);
    setOpen(true);
  };
  const apply = () => {
    const got = parseBallotText(text, slugs);
    if ("error" in got) return setError(got.error);
    setError(undefined);
    setText("");
    if (onApply(got.tiers)) setKept(true);
    else setOpen(false);
  };
  const copy = async (value: string, flash: (s: string) => void, fallback: string) => {
    try {
      await navigator.clipboard.writeText(value);
      flash("Copied.");
    } catch {
      flash(fallback);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2 font-inter-tight text-[12px] text-white/80 hover:bg-white/10 hover:text-white"
      >
        <Bot className="size-3.5 opacity-80" aria-hidden="true" />
        Use an LLM…
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Build your ballot with an LLM"
        description="Use any LLM that can read web pages. Give it the guide and tell it what you care about; it answers with a ballot you paste back here."
        className="w-[min(520px,100%)] gap-[18px] max-sm:p-5"
        focusField={false}
        icon={<Bot className="size-5" />}
      >
        <section aria-labelledby="llm-give" className="space-y-2">
          <h4 id="llm-give" className="kicker m-0 py-1 text-[11px] tracking-[.16em]">
            Give the LLM
          </h4>
          <ul className="m-0 list-none divide-y divide-white/10 rounded-[14px] border border-white/10 bg-white/[.03] p-0">
            <GiveRow
              icon={<Link2 className="size-4" />}
              title="The guide"
              note={
                <>
                  Rules, format and every project ·{" "}
                  <a
                    href={LLMS}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/70 underline-offset-2 hover:text-white hover:underline"
                  >
                    open it
                  </a>
                </>
              }
              button="Copy link"
              copyLabel="Copy the guide's link"
              flash={linkCopied}
              onCopy={() =>
                void copy(
                  llmsUrl,
                  flashLink,
                  "Couldn't copy: open the guide and copy its address.",
                )}
            />
            <GiveRow
              icon={<ListOrdered className="size-4" />}
              title={
                <>
                  Your ballot <span className="font-normal text-white/50">(optional)</span>
                </>
              }
              note={placed
                ? `${placed} ${placed === 1 ? "initiative" : "initiatives"} in ${tierCount} ${
                  tierCount === 1 ? "tier" : "tiers"
                }: to start from it`
                : "Empty so far"}
              button="Copy"
              copyLabel="Copy your ballot"
              disabled={!placed}
              flash={ballotCopied}
              onCopy={() =>
                void copy(
                  formatBallotPb(tiers, { slugs, titles, askUsd }),
                  flashBallot,
                  "Couldn't copy: your browser blocked it.",
                )}
            />
          </ul>
          <p className="m-0 pt-1 text-[12.5px] leading-snug text-white/55">
            Then tell it your priorities, or your star ratings: it can't see them.
          </p>
        </section>

        <section className="space-y-2">
          <label
            htmlFor="paste-ballot"
            className="kicker m-0 block py-1 text-[11px] tracking-[.16em]"
          >
            Paste its ballot
          </label>
          {kept
            ? (
              <div className="space-y-3">
                <p role="status" className="m-0 text-[13.5px] text-white/80">
                  Pasted. Settled tiers stay as they were counted.
                </p>
                <div className="flex justify-end">
                  <Button sm variant="primary" onClick={() => setOpen(false)}>Done</Button>
                </div>
              </div>
            )
            : (
              <>
                <textarea
                  id="paste-ballot"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="slug-a=slug-b=slug-c,slug-d,slug-e"
                  className="mono block w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 leading-normal text-white placeholder:text-white/35"
                />
                {error && <p role="alert" className="m-0 text-[13px] text-amber-200">{error}</p>}
                <Button
                  sm
                  variant="primary"
                  disabled={!text.trim()}
                  onClick={apply}
                  className="w-full max-sm:h-11"
                >
                  Use this ballot
                </Button>
                <p className="m-0 text-center text-[12.5px] text-white/50">
                  Replaces your draft. Nothing is sent.
                </p>
              </>
            )}
        </section>
      </Dialog>
    </>
  );
}
