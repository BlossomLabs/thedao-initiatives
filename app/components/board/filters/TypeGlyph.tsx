import type { BoardType } from "~/lib/board-view";

// The card badges' colours: RFP blue, grant green.
const RFP = "#7eb3ff";
const GRANT = "#00ff88";

/** A type as a small badge shape in its card badge's colour; all types overlaps the two. */
export default function TypeGlyph({ type }: { type: BoardType }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 flex-none"
      aria-hidden="true"
      data-type-glyph={type}
    >
      {type === "all"
        ? (
          <>
            <rect
              x="1.5"
              y="3"
              width="9"
              height="7"
              rx="2"
              fill={RFP}
              fillOpacity=".35"
              stroke={RFP}
              strokeWidth="1.2"
            />
            <rect
              x="5.5"
              y="6"
              width="9"
              height="7"
              rx="2"
              fill={GRANT}
              fillOpacity=".25"
              stroke={GRANT}
              strokeOpacity=".8"
              strokeWidth="1.2"
            />
          </>
        )
        : (
          <rect
            x="2"
            y="4"
            width="12"
            height="8"
            rx="2.2"
            fill={type === "rfp" ? RFP : GRANT}
            fillOpacity={type === "rfp" ? ".3" : ".22"}
            stroke={type === "rfp" ? RFP : GRANT}
            strokeOpacity=".85"
            strokeWidth="1.2"
          />
        )}
    </svg>
  );
}
