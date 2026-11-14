import { Landmark, Wallet } from "lucide-react";
import { Link } from "react-router";
import { Button } from "~/components/ui/Button";
import { lazyPart } from "~/lib/lazy-part";
import { cn } from "~/lib/utils";

/**
 * The Donate panel carries the wallet stack, so it loads apart from the page: on a
 * board card once its Donate button is hovered or pressed, on an initiative's page
 * right after the page shows. Until it is in, and if its chunk fails,
 * this look-alike takes its place: the same layout, every control disabled.
 */
export function DonateStandIn() {
  const chip =
    "whitespace-nowrap rounded-full border border-edge2 bg-white/5 px-1 py-2 text-center font-inter-tight text-[13px] text-soft max-[760px]:py-[11px]";
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5 pb-2.5">
        <div className="grid grid-cols-4 gap-1.5">
          {["50", "500", "5000", "50000"].map((c) => (
            <button key={c} type="button" className={chip} disabled>
              ${Number(c).toLocaleString("en-US")}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-0.5 rounded-xl border border-edge2 bg-card pl-3.5">
            <span className="flex-none font-inter-tight text-[14px] font-light text-muted">$</span>
            <input
              className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 pr-3.5 font-inter-tight text-[14px] font-light text-white outline-none placeholder:text-white/35"
              placeholder="Custom amount"
              aria-label="Amount in US dollars"
              disabled
            />
          </label>
          <div className="w-[110px] flex-none rounded-xl border border-edge2 bg-card py-2.5 pl-3 pr-2 font-inter-tight text-[14px] text-white/60">
            USDC
          </div>
        </div>
      </div>
      <label className="my-0.5 flex items-center gap-2 small text-soft">
        <input type="checkbox" className="size-4" disabled />
        <span>
          I agree to these{" "}
          <Link to="/donation-terms" target="_blank" rel="noopener" className="underline">
            Donation Terms
          </Link>.
        </span>
      </label>
      <div className="flex gap-1.5 rounded-[14px] border border-edge bg-white/[.03] p-1">
        {[
          { label: "Wallet", icon: <Wallet className="size-[15px]" /> },
          { label: "Exchange", icon: <Landmark className="size-[15px]" /> },
        ].map((m, i) => (
          <button
            key={m.label}
            type="button"
            disabled
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border border-transparent px-1.5 py-2 font-inter-tight text-[12.5px] font-medium text-muted max-[760px]:py-3",
              i === 0 && "border-edge2 bg-card text-white",
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
      <Button variant="primary" disabled>Donate</Button>
    </div>
  );
}

export const { Component: DonateWidget, preload: preloadDonate } = lazyPart(
  () => import("~/components/donate/DonateWidget"),
  DonateStandIn,
);
