import { NewMarker } from "~/components/board/WatchlistButton";
import { isNew } from "~/hooks/use-watchlist";
import { cn } from "~/lib/utils";

export type CardLabelKind = "ai" | "featured" | "new";

/** One label per initiative, by priority: AI pick, then Featured, then New. */
export const cardLabel = (
  { aiTop, featured, approvedAt }: {
    aiTop?: boolean;
    featured?: boolean;
    approvedAt: number | null;
  },
): CardLabelKind | null => aiTop ? "ai" : featured ? "featured" : isNew(approvedAt) ? "new" : null;

const PILL =
  "rounded-full px-2.5 py-[3px] font-inter-tight text-[11px] font-bold uppercase tracking-[.4px]";

/** The label itself, the same on a card's top edge and in a list row. */
export default function CardLabel(
  { kind, className }: { kind: CardLabelKind; className?: string },
) {
  if (kind === "new") return <NewMarker className={className} />;
  if (kind === "featured") {
    return (
      <span
        className={cn(PILL, "border border-white/25 bg-[#24506f] text-white", className)}
        title="Pinned to the top by the team"
      >
        Featured
      </span>
    );
  }
  return <span className={cn(PILL, "bg-dao-green text-[#08321c]", className)}>AI pick</span>;
}
