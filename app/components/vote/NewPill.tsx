import { NewMarker } from "~/components/board/WatchlistButton";
import { cn } from "~/lib/utils";

/** New on the ballot since this badge last sent its ballot: the board's New pill, on the
 * box's top edge at the right, as a board card carries AI pick. Its parent is positioned
 * and doesn't clip. A morph (peek-morph.ts) carries it with the card (`data-peek-new`),
 * so it never drops under the card while the card moves. `card`: the bigger one, on an
 * open card. */
export default function NewPill({ card = false }: { card?: boolean }) {
  return (
    <span
      data-peek-new=""
      className={cn(
        "pointer-events-none absolute z-[1] flex",
        card ? "-top-2.5 right-5" : "-top-2 right-3",
      )}
    >
      <NewMarker
        title="Added since you last sent your ballot"
        className={card ? "px-2.5 py-[3px] text-[11px]" : "px-2 py-px text-[10px]"}
      />
    </span>
  );
}
