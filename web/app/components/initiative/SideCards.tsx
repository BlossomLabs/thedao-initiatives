import { MessageSquare } from "lucide-react";
import DonateWidget from "~/components/donate/DonateWidget";
import type { InitiativePage } from "~/lib/api-types";
import { GRIFF_X } from "~/data/site";

export default function SideCards(
  { page, safeThreshold, onDonated }: {
    page: InitiativePage;
    safeThreshold?: number;
    onDonated?: () => void;
  },
) {
  const r = page.initiative;
  return (
    <aside className="sticky top-[86px] flex flex-col gap-3.5 max-[960px]:static">
      <div className="panel border-[rgba(92,183,90,.35)] shadow-[0_0_34px_rgba(92,183,90,.07)]">
        <span className="k">Donate to this initiative</span>
        {page.donationsEnabled
          ? (
            <DonateWidget
              slug={r.slug}
              safeAddress={r.safeAddress}
              onramp={page.onramp}
              manual
              safeThreshold={safeThreshold}
              onConfirmed={onDonated}
            />
          )
          : (
            <p className="m-0 small">
              {!r.safeAddress
                ? "This initiative's donation address is being set up. Check back soon."
                : "Donations are temporarily unavailable."}
            </p>
          )}
      </div>
      {r.discourseUrl && (
        <div className="panel border-[rgba(90,200,250,.35)]">
          <span className="k">Join the discussion</span>
          <p className="m-0 mb-2 small dim">This initiative is being shaped in public.</p>
          <a
            className="btn btn-discuss mt-1 w-full"
            href={r.discourseUrl}
            target="_blank"
            rel="noopener"
          >
            <MessageSquare className="size-[15px]" />Open the forum thread
          </a>
        </div>
      )}
      <div className="panel">
        <span className="k">Back this initiative</span>
        <p className="m-0 small dim">
          Companies can pledge instead of donating: you commit publicly now and pay only when the
          work is completed and verified.{" "}
          <a href={GRIFF_X} target="_blank" rel="noopener">DM @griffgreen</a>{" "}
          and your name appears here.
        </p>
      </div>
      <div className="panel">
        <span className="k">What happens next</span>
        <p className="m-0 small dim">
          If backers and donors fully fund this initiative, it happens with no TheDAO money at all.
          If it comes up short, the 200 ETHSecurity badge holders rank it against the other
          initiatives in the October round and TheDAO Security Fund completes the top-ranked ones.
          Donations count as a public signal in that ranking.
        </p>
      </div>
    </aside>
  );
}
