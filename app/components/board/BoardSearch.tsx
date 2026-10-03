import type { AiSearchResult } from "../../../shared/ai-search";
import { useEffect, useId, useRef, useState } from "react";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { api, errorMessage } from "~/lib/api";
import { Button } from "~/components/ui/Button";
import { usePhone } from "~/hooks/use-media";
import type { BoardView } from "~/lib/board-view";
import {
  boardQueryText,
  parseBoardQuery,
  setBoardQualifier,
  setBoardWords,
} from "~/lib/board-query";
import { cn } from "~/lib/utils";

type Filters = Pick<BoardView, "q" | "type" | "cats" | "status">;

/**
 * The board's one search box, in two modes.
 * - Keywords (as you type): every word must match an initiative's title,
 *   summary, team or category; `type:grant cat:opsec funding:open` move the
 *   pills, and the pills write them back.
 * - AI (Enter, or Ask AI): the words go to the model, which ranks every
 *   initiative; scores order the whole board and the board sets the keyword filter
 *   aside while that order is on (the qualifiers still filter). Esc, editing
 *   the text, or a manual sort go back.
 * The icon, a tag in the box and the note under it say which mode is on.
 */
export default function BoardSearch(
  { view, onFilter, aiEnabled, active, onResults, onAsking }: {
    view: Filters;
    onFilter: (next: Partial<BoardView>) => void;
    aiEnabled: boolean;
    /** Whether the board still shows the AI order (a manual sort clears it). */
    active: boolean;
    onResults: (result: AiSearchResult | null) => void;
    /** While the model is thinking: the board says so instead of an empty result. */
    onAsking?: (asking: boolean) => void;
  },
) {
  const [text, setText] = useState(() => boardQueryText(view));
  const [aiMode, setAiMode] = useState(false);
  const noteId = useId();
  // The latest search wins: an answer to an earlier one is dropped.
  const seq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<React.ReactNode>(null);
  const [failed, setFailed] = useState(false);
  const phone = usePhone();
  const { query, problems } = parseBoardQuery(text);
  useEffect(() => onAsking?.(busy), [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = query.words.join(" ");

  // Keep the box and the filters in step when they change elsewhere (a pill,
  // Clear filters): rewrite only what differs, so typing is never disturbed.
  useEffect(() => {
    const p = parseBoardQuery(text).query;
    let next = text;
    if (p.type !== view.type) next = setBoardQualifier(next, "type", view.type);
    if (p.cats.join() !== view.cats.join()) next = setBoardQualifier(next, "cat", view.cats);
    if (p.status !== view.status) next = setBoardQualifier(next, "funding", view.status);
    if (p.words.join(" ") !== view.q.trim().toLowerCase()) {
      next = setBoardWords(next, view.q);
    }
    if (next !== text) setText(next);
  }, [view.type, view.cats.join(), view.status, view.q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to keywords: the AI order goes, so the words filter again.
  const leaveAi = () => {
    setAiMode(false);
    setNote(null);
    onResults(null);
  };

  // The board cleared the AI order (a manual sort): back to keywords.
  useEffect(() => {
    if (!active && aiMode) {
      setAiMode(false);
      setNote(null);
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(next: string) {
    setText(next);
    setFailed(false);
    const p = parseBoardQuery(next).query;
    if (aiMode) {
      setAiMode(false);
      setNote(null);
      onResults(null);
    } else if (note) setNote(null);
    onFilter({ type: p.type, cats: p.cats, status: p.status, q: p.words.join(" ") });
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!aiEnabled) return;
    if (words.length < 3) {
      setFailed(true);
      setNote("Describe what you want to fund in a few words, then press Enter.");
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    setFailed(false);
    setNote(null);
    try {
      const result = await api<AiSearchResult>("/api/ai-search", {
        json: { query: words },
      });
      if (mine !== seq.current) return;
      if (!result.scores.length) {
        setNote("No initiatives to rank; filtering by your keywords.");
        return;
      }
      setAiMode(true);
      onResults(result); // the board sets the words aside while this order is on
      setNote(
        <>
          Initiatives ordered by relevance; type:, cat: and funding: still filter.{" "}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
            onClick={() => leaveAi()}
          >
            Back to keywords
          </button>{" "}
          <span className="max-[640px]:hidden">(Esc)</span>
        </>,
      );
    } catch (err) {
      if (mine !== seq.current) return;
      setFailed(true);
      setNote(errorMessage(err));
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  const hint = problems.length ? problems.join(" ") : null;
  return (
    <>
      <form className="mb-5 mt-1 flex" autoComplete="off" onSubmit={run}>
        <div className="relative min-w-0 flex-1">
          {aiMode
            ? (
              <Sparkles
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-dao-green"
                aria-hidden="true"
              />
            )
            : (
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-white/45"
                aria-hidden="true"
              />
            )}
          <input
            type="search"
            className={cn(
              "field pl-11 placeholder:text-white/25 min-[641px]:pr-[8.5rem]",
              aiEnabled && "rounded-r-none border-r-0",
              aiMode ? "border-[rgba(92,183,90,.55)]" : "border-white/10",
            )}
            maxLength={300}
            spellCheck={false}
            placeholder={aiEnabled
              ? phone
                ? "Search, or ask AI"
                : "Search by keyword, or describe the work you want to fund and press Enter to ask AI"
              : "Search by keyword, type:grant, cat:opsec, funding:open"}
            aria-label={aiEnabled
              ? "Search initiatives by keyword, or describe the work you want to fund and press Enter to ask AI"
              : "Search initiatives by keyword"}
            aria-describedby={note || hint ? noteId : undefined}
            value={text}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && aiMode) {
                e.preventDefault();
                leaveAi();
              }
            }}
          />
          {/* Which mode the box is in, at its end (desktop). */}
          {aiEnabled && (aiMode || words) && (
            <span
              className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 font-inter-tight text-[12px] max-[640px]:hidden"
              aria-hidden="true"
            >
              {aiMode
                ? (
                  <span className="rounded-full bg-dao-green px-2 py-[2px] font-bold uppercase tracking-[.4px] text-[#08321c] text-[10.5px]">
                    AI matches
                  </span>
                )
                : (
                  <>
                    <kbd className="inline-flex items-center rounded-md border border-white/15 bg-white/5 px-1.5 py-[1px] font-inter-tight text-[11px] text-white/60">
                      <CornerDownLeft className="size-3" />
                    </kbd>
                    <span className="text-white/45">Ask AI</span>
                  </>
                )}
            </span>
          )}
        </div>
        {/* Joined to the input's end on every width; on phones it shrinks to its icon. */}
        {aiEnabled && (
          <Button
            variant="primary"
            type="submit"
            loading={busy}
            aria-label="Ask AI"
            className="flex-none rounded-l-none max-[640px]:w-[51px] max-[640px]:px-0"
          >
            <span className="max-[640px]:hidden">Ask AI</span>
            <Sparkles className="size-4" aria-hidden="true" />
          </Button>
        )}
      </form>
      {(note || hint) && (
        <p
          // Keyed so a repeated refusal animates in again.
          key={failed ? String(note) : "result"}
          id={noteId}
          role={failed ? "alert" : "status"}
          className={cn(
            "-mt-2 mb-[18px] small",
            failed ? "text-[#ffd7d6]" : hint && !note ? "text-dao-amber" : "dim",
          )}
        >
          {note ?? hint}
        </p>
      )}
    </>
  );
}
