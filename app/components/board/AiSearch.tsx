import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { api, errorMessage } from "~/lib/api";
import { Button } from "~/components/ui/Button";
import { usePhone } from "~/hooks/use-media";
import { cn } from "~/lib/utils";

/**
 * "Find matches": the LLM ranks initiatives and the relevant ones move first;
 * only the order changes, client-side, and the filters still apply. `active`
 * is whether the board still shows that order (a manual sort clears it).
 */
export default function AiSearch(
  { active, onMatches }: { active: boolean; onMatches: (ids: string[] | null) => void },
) {
  const [q, setQ] = useState("");
  const hintId = useId();
  // The latest search wins: an answer to an earlier one is dropped.
  const seq = useRef(0);
  // Whether the note says the order changed: only that note goes when the order does.
  const reordered = useRef(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<React.ReactNode>(null);
  const [failed, setFailed] = useState(false);
  const phone = usePhone();

  // The board cleared the AI order (a manual sort): the note no longer holds.
  useEffect(() => {
    if (!active && reordered.current) {
      reordered.current = false;
      setNote(null);
    }
  }, [active]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 3) {
      setFailed(true);
      setNote("Describe what you want to fund in a few words.");
      return;
    }
    const mine = ++seq.current;
    reordered.current = false;
    setBusy(true);
    setFailed(false);
    setNote(null);
    try {
      const { matches } = await api<{ matches: string[] }>("/api/ai-search", {
        json: { query },
      });
      if (mine !== seq.current) return;
      reordered.current = matches.length > 0;
      onMatches(matches);
      setNote(
        matches.length
          ? (
            <>
              Relevant initiatives moved to the front; your filters still apply.{" "}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
                onClick={() => {
                  onMatches(null);
                  setNote(null);
                }}
              >
                Show the default order
              </button>
            </>
          )
          : "No clear matches; showing everything.",
      );
    } catch (err) {
      if (mine !== seq.current) return;
      setFailed(true);
      setNote(errorMessage(err));
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  // Figma: 51px input (14px radius, white/5 fill, white/10 border, 18px icon 16px in,
  // 44px left padding) + 51px red button, 10px apart, 20px above the cards.
  return (
    <>
      <form className="mb-5 mt-1 flex" autoComplete="off" onSubmit={run}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-white/45" />
          <input
            className="field rounded-r-none border-r-0 border-white/10 pl-11 placeholder:text-white/25"
            maxLength={300}
            placeholder={phone
              ? "What do you want to fund?"
              : "What kind of security work do you want to fund? Describe it and we'll surface the best matches."}
            aria-label="Describe the security work you want to fund"
            aria-describedby={note ? hintId : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {/* Joined to the input's end on every width; on phones it shrinks to its arrow. */}
        <Button
          variant="primary"
          type="submit"
          loading={busy}
          aria-label="Find matches"
          className="flex-none rounded-l-none max-[640px]:w-[51px] max-[640px]:px-0"
        >
          <span className="max-[640px]:hidden">Find matches</span>
          <ArrowRight className="size-4" />
        </Button>
      </form>
      {note && (
        <p
          // Keyed so a repeated refusal animates in again.
          key={failed ? String(note) : "result"}
          id={hintId}
          role={failed ? "alert" : "status"}
          className={cn("-mt-2 mb-[18px] small", failed ? "text-[#ffd7d6]" : "dim")}
        >
          {note}
        </p>
      )}
    </>
  );
}
