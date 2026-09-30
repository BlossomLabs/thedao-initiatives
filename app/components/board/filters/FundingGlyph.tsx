import { PartyPopper } from "lucide-react";
import type { BoardStatus } from "~/lib/board-view";

/**
 * Funding status as a 14px glyph, in the funding bar's colours: a dashed ring for
 * any status, part-filled for open for funding, a check once the first goal is
 * reached, and a party popper once fully funded.
 */
export default function FundingGlyph({ status }: { status: BoardStatus }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 flex-none" aria-hidden="true">
      {status === "all" && (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeOpacity=".55"
          strokeWidth="1.6"
          strokeDasharray="2.4 2.2"
        />
      )}
      {status === "open" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="#5cb75a"
            strokeOpacity=".3"
            strokeWidth="1.8"
          />
          <path
            d="M8 2a6 6 0 0 1 5.2 9"
            fill="none"
            stroke="#5cb75a"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      )}
      {status === "first-goal" && (
        <>
          <circle cx="8" cy="8" r="7" fill="#5cb75a" />
          <path
            d="M5 8.2l2 2 4-4.2"
            fill="none"
            stroke="#0b2a1a"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === "funded" && (
        // Fully funded: a party popper.
        <PartyPopper x="1" y="1" width="14" height="14" stroke="#5cb75a" strokeWidth={2.2} />
      )}
    </svg>
  );
}
