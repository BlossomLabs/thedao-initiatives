import { useState } from "react";
import { Button } from "~/components/ui/Button";
import type { Tier } from "../../../shared/vote/ballot";
import { formatBallotPb, parseBallotText } from "../../../shared/vote/pb";

/** Paste a ballot (pabutools, Blossom ties), copy this one the same way, and the
 * /vote/llms.txt guide for having an LLM draft it. Pasting only replaces the draft. */
export default function PasteBallot({ slugs, titles, askUsd, tiers, onApply }: {
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
  const [note, setNote] = useState<string>();

  const apply = () => {
    const got = parseBallotText(text, slugs);
    if ("error" in got) return setError(got.error);
    setError(undefined);
    setOpen(false);
    setText("");
    setNote(onApply(got.tiers) ? "Settled tiers stay as they were counted." : undefined);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatBallotPb(tiers, { slugs, titles, askUsd }));
      setNote("Copied.");
    } catch {
      setNote("Couldn't copy: your browser blocked it.");
    }
  };

  const link = "text-[13px] text-white/60 underline underline-offset-2 hover:text-white";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <button type="button" className={link} onClick={() => setOpen((o) => !o)}>
          Paste a ballot
        </button>
        <button type="button" className={link} onClick={() => void copy()}>
          Copy my ballot
        </button>
        <a className={link} href="/vote/llms.txt" target="_blank" rel="noopener noreferrer">
          Build your ballot with an LLM
        </a>
      </div>
      {open && (
        <div className="space-y-2">
          <label htmlFor="paste-ballot" className="sr-only">Ballot to paste</label>
          <textarea
            id="paste-ballot"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="slug-a=slug-b=slug-c,slug-d,slug-e  (or a whole .pb file)"
            className="mono w-full rounded-lg border border-white/15 bg-white/5 p-2 text-[12.5px] text-white"
          />
          {error && <p role="alert" className="text-[13px] text-amber-200">{error}</p>}
          <div className="flex gap-2">
            <Button sm variant="primary" onClick={apply}>Apply</Button>
            <Button sm onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {note && <p role="status" className="text-center text-[13px] text-white/70">{note}</p>}
    </div>
  );
}
