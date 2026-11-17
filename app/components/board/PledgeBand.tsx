import { Button } from "~/components/ui/Button";
import { openPledgeRequest } from "~/lib/support";
import { cn } from "~/lib/utils";

// Figma: 28px 32px band 46px below the grid, 18px title, 14px copy, 51px button with ↗.
// `compact`: the vote results' version, at the top (#127): one short row, no gap above.
export default function PledgeBand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between rounded-2xl border border-white/[.09] bg-white/5",
        compact ? "gap-x-5 gap-y-2.5 px-5 py-3.5" : "mt-[46px] gap-[22px] px-8 py-7",
      )}
    >
      <div className="min-w-0 flex-1">
        <b
          className={cn(
            "font-inter-tight font-medium",
            compact ? "text-[15.5px]" : "text-[18px]",
          )}
        >
          Want to pledge support?
        </b>
        <p
          className={cn(
            "m-0 max-w-[470px] font-inter-tight leading-[1.6] text-white/50",
            compact ? "mt-0.5 text-[13.5px]" : "mt-2 text-[14px]",
          )}
        >
          Backers pledge now and pay only when the work is fully funded.
        </p>
      </div>
      <Button
        variant="primary"
        sm={compact}
        className="flex-none"
        onClick={() => openPledgeRequest()}
        aria-haspopup="dialog"
      >
        Pledge to an initiative
      </Button>
    </div>
  );
}
