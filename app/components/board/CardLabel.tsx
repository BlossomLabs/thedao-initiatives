import { NewMarker } from "~/components/board/WatchlistButton";
import { isNew } from "~/hooks/use-watchlist";
import { Pin } from "lucide-react";
import { cn } from "~/lib/utils";

export type CardLabelKind = "ai" | "featured" | "new";

/**
 * An initiative's labels, in order: one word, AI pick over New (never both), then
 * the Featured pin, which goes with either word.
 */
export const cardLabel = (
  { aiTop, featured, approvedAt }: {
    aiTop?: boolean;
    featured?: boolean;
    approvedAt: number | null;
  },
): CardLabelKind[] => {
  const word: CardLabelKind | null = aiTop ? "ai" : isNew(approvedAt) ? "new" : null;
  const out: CardLabelKind[] = word ? [word] : [];
  return featured ? [...out, "featured"] : out;
};

const PILL =
  "rounded-full px-2.5 py-[3px] font-inter-tight text-[11px] font-bold uppercase tracking-[.4px]";

/** One label, the same on a card's top edge and in a list row. */
export default function CardLabel(
  { kind, className, aiScore }: { kind: CardLabelKind; className?: string; aiScore?: number },
) {
  if (kind === "new") return <NewMarker className={className} />;
  if (kind === "featured") {
    // A pin, not a word: pinned to the top by the team. Its own round shape, so the
    // padding a list row passes for the text labels does not stretch it.
    return (
      <span
        className={cn(
          "inline-grid size-[22px] flex-none place-items-center rounded-full border border-white/25 bg-[#24506f] text-white",
          className,
          "p-0!",
        )}
        title="Pinned to the top by the team"
      >
        <Pin className="size-3 rotate-45" strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">Featured</span>
      </span>
    );
  }
  return (
    <span className={cn(PILL, "bg-dao-green text-[#08321c]", className)}>
      <span>AI pick</span>
      {aiScore !== undefined && (
        <span className="ml-1.5 tabular-nums opacity-75" title="AI relevance score">
          {Math.round(aiScore * 100)}%
        </span>
      )}
    </span>
  );
}
