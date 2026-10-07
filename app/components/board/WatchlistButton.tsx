import { Bookmark } from "lucide-react";
import { cn } from "~/lib/utils";

/** Add an initiative to this browser's watchlist (localStorage), for the Watchlist filter. */
export default function WatchlistButton(
  { on, onToggle, title, className }: {
    on: boolean;
    onToggle: () => void;
    title: string;
    className?: string;
  },
) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
      title={on ? "On your watchlist" : "Add to watchlist"}
      onClick={onToggle}
      className={cn(
        "inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-white/40 transition-colors hover:text-dao-amber focus-visible:outline-2 focus-visible:outline-dao-bright",
        on && "text-dao-amber",
        className,
      )}
    >
      <Bookmark className="size-4" fill={on ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}

/** "New": approved in the last 7 days. On a card it sits on the top edge with
 * Featured and AI pick, in their shape; sky, since red means OpSec and danger here. */
export function NewMarker({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full border border-[rgba(90,200,250,.45)] bg-[#1d4a66] px-2.5 py-[3px] font-inter-tight text-[11px] font-bold uppercase tracking-[.4px] text-[#9ddcfb]",
        className,
      )}
      title="Approved in the last 7 days"
    >
      New
    </span>
  );
}
