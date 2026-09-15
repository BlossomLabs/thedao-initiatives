import { MessageSquare, PencilLine, Settings2 } from "lucide-react";
import StickyAside from "~/components/layout/StickyAside";
import DonateWidget from "~/components/donate/DonateWidget";
import { LinkButton } from "~/components/ui/Button";
import RevisionPanel, { type ViewMode } from "~/components/initiative/RevisionBar";
import KeyFacts from "~/components/initiative/KeyFacts";
import { useSession } from "~/context/session";
import type { InitiativePage } from "~/lib/api-types";
import { openDiscussion } from "~/lib/discussion";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "~/data/site";
import { WHAT_NEXT } from "~/data/what-next";

export default function SideCards(
  { page, onDonated, revisions }: {
    page: InitiativePage;
    onDonated?: () => void;
    /** History navigation state owned by the page; omitted when there is nothing to browse. */
    revisions?: { viewing: number; current: number; mode: ViewMode; onMode: (m: ViewMode) => void };
  },
) {
  const r = page.initiative;
  const { session } = useSession();
  const mine = Boolean(
    session && r.proposer && session.address.toLowerCase() === r.proposer.toLowerCase(),
  );
  const editable = r.status === "pending" || r.status === "approved";
  return (
    <StickyAside className="flex flex-col gap-3.5 max-[960px]:static">
      <div className="panel border-[rgba(92,183,90,.35)] shadow-[0_0_34px_rgba(92,183,90,.07)]">
        <span className="k">Donate to this initiative</span>
        {page.donationsEnabled
          ? (
            <DonateWidget
              key={r.id}
              initiativeId={r.id}
              slug={r.slug}
              safeAddress={r.safeAddress}
              onramp={page.onramp}
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
      <KeyFacts r={r} summary={page.summary} />
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
            <MessageSquare className="size-[15px]" />
            {openDiscussion(r.discourseUrl)}
          </a>
        </div>
      )}
      <div className="panel">
        <span className="k">Back this initiative</span>
        <p className="m-0 small dim">
          Companies can pledge instead of donating: you commit publicly now and pay only when the
          work is completed and verified. Email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>{" "}
          and your name appears here.
        </p>
      </div>
      <div className="panel">
        <span className="k">What happens next</span>
        <p className="m-0 small dim">{WHAT_NEXT[r.type]}</p>
      </div>
      {revisions && <RevisionPanel slug={r.slug} revisions={page.revisions} {...revisions} />}
      {mine && editable && (
        <div className="panel border-[rgba(90,200,250,.35)]">
          <span className="k">Your initiative</span>
          <p className="m-0 mb-2 small dim">
            {r.status === "pending"
              ? "You proposed this initiative. While it waits for review you can change everything here; every version stays in the history."
              : "You proposed this initiative. Edits to the text, milestones and links go live at once and every version stays in the history; the money facts are locked."}
          </p>
          <LinkButton variant="ghost" className="mt-1 w-full" to={`/initiative/${r.slug}/edit`}>
            <PencilLine className="size-[15px]" />Edit initiative
          </LinkButton>
        </div>
      )}
      {session?.isAdmin && (
        <div className="panel border-[rgba(255,180,50,.32)]">
          <span className="k">Only admins</span>
          <p className="m-0 mb-2 small dim">Edit, approve, or sync this initiative.</p>
          <LinkButton variant="ghost" className="mt-1 w-full" to={`/admin/initiatives/${r.slug}`}>
            <Settings2 className="size-[15px]" />Manage initiative
          </LinkButton>
        </div>
      )}
    </StickyAside>
  );
}
