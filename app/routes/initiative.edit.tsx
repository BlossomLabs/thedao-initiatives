import { useEffect, useMemo } from "react";
import StickyAside from "~/components/layout/StickyAside";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import Crumbs from "~/components/layout/Crumbs";
import PageMain from "~/components/layout/PageMain";
import Skeleton from "~/components/ui/Skeleton";
import Status from "~/components/ui/Status";
import { LinkButton } from "~/components/ui/Button";
import Identity from "~/components/wallet/Identity";
import InitiativeForm from "~/components/initiative-form/InitiativeForm";
import type { SubmitPayload } from "~/components/initiative-form/types";
import { fromInitiative } from "~/components/initiative-form/useDraft";
import { useSession } from "~/context/session";
import { initiativeKey, useInitiative } from "~/hooks/use-initiative";
import { useRevision } from "~/hooks/use-revision";
import { api, ApiError, errorMessage } from "~/lib/api";
import type { Initiative, Pledge } from "~/lib/api-types";
import { pageFactsPatch, textBody, textChanged } from "~/lib/edit-initiative";
import { CONTACT_EMAIL, CONTACT_MAILTO, SITE_NAME } from "~/data/site";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Edit initiative" });
}

/**
 * The proposer's edit page, on the same form as the submit page. Sections,
 * milestones, links, title, summary and categories are always editable and
 * every save is a new public revision. While the initiative is pending the page facts
 * (type, goal, duration, recipient, reviewer, forum link) and the private
 * fields can change too; after approval those belong to the team. It is the
 * team's editor as well: an admin works under the same rules, tagged as the
 * team, and the facts are never locked for them. The proposer's edit to an
 * approved initiative does not go live: it waits for the team, the form then
 * starts from that edit, and saving again replaces it.
 */
export default function EditInitiative() {
  const { slug = "" } = useParams();
  const { session, address } = useSession();
  const { data: page, isLoading, error, isPlaceholderData } = useInitiative(slug);

  useEffect(() => {
    if (page) document.title = `Edit · ${page.initiative.title} · ${SITE_NAME}`;
  }, [page]);

  const r = page?.initiative;
  const mine = Boolean(
    session && r?.proposer && session.address.toLowerCase() === r.proposer.toLowerCase(),
  );
  const team = Boolean(session?.isAdmin);
  const allowed = mine || team;
  const open = r?.status === "pending" || r?.status === "approved";
  // Approval is a review of the text: the proposer's edit to it waits for the team.
  const hold = !team && r?.status === "approved";
  const waitingN = hold && r?.pendingRevision ? r.pendingRevision : null;
  const waiting = useRevision(slug, waitingN);
  const edit = waitingN ? waiting.data : undefined;
  // The row the form starts from: the edit in review when there is one.
  const base = useMemo(
    () =>
      r && edit
        ? {
          ...r,
          title: edit.title,
          summary: edit.summary,
          details: edit.details,
          sections: edit.sections,
          milestones: edit.milestones,
          links: edit.links,
          categories: edit.categories ?? r.categories,
        }
        : r,
    [r, edit],
  );

  let body: React.ReactNode;
  // the board placeholder has no pledges, and the form reads its draft once
  if (isLoading || isPlaceholderData || (waitingN && !edit && !waiting.error)) {
    body = (
      <div className="panel mt-2 flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else if (!page || !r) {
    const gone = error instanceof ApiError && error.status === 404;
    body = (
      <div className="panel mt-2 flex flex-col gap-3">
        <p className="m-0 font-inter-tight text-[15px] font-semibold">
          {gone && !session
            ? "Sign in with the wallet that proposed this initiative"
            : "This initiative could not be loaded."}
        </p>
        <p className="m-0 small dim">
          {gone && !session
            ? "Use the Connect wallet button in the top right. A submission under review is only visible to its proposer."
            : gone
            ? "There is no initiative at this address that this wallet can edit."
            : errorMessage(error)}
        </p>
        <Link className="btn self-start" to="/">All initiatives</Link>
      </div>
    );
  } else if (!allowed) {
    body = (
      <div className="panel mt-2 flex flex-col gap-3">
        <p className="m-0 font-inter-tight text-[15px] font-semibold">
          Only the proposer can edit this initiative
        </p>
        <p className="m-0 small dim inline-flex flex-wrap items-center gap-1.5">
          {r.proposer
            ? (
              <>
                It was proposed by <Identity address={r.proposer} size={18} />
                {address && <>; you are signed in as {<Identity address={address} size={18} />}.</>}
              </>
            )
            : "It was published from a content file, so it has no proposer wallet."}
        </p>
        <LinkButton className="self-start" to={`/initiative/${r.slug}`}>
          Back to the initiative
        </LinkButton>
      </div>
    );
  } else if (!open) {
    body = (
      <div className="panel mt-2 flex flex-col gap-3">
        <p className="m-0 font-inter-tight text-[15px] font-semibold">
          This initiative is no longer open for edits
        </p>
        <p className="m-0 small dim">
          It is {r.status}. Email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>{" "}
          if it should be reopened.
        </p>
        <LinkButton className="self-start" to={`/initiative/${r.slug}`}>
          Back to the initiative
        </LinkButton>
      </div>
    );
  } else {
    body = null;
  }

  return (
    <PageMain detail>
      <Crumbs
        items={[
          { label: "Initiatives", to: "/" },
          ...(r ? [{ label: r.title, to: `/initiative/${r.slug}` }] : []),
        ]}
      />
      <h1 className="mb-3 mt-1.5 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium leading-[1.12] tracking-[-.02em]">
        Edit initiative
      </h1>
      <p className="mt-3.5 max-w-[760px] font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        {hold
          ? "This initiative is approved, so your edit goes to the team first: the public page keeps the approved version until the team accepts it. Every published version is kept in the history on the initiative page."
          : "Changes go live as soon as you save. Every version is kept and anyone can browse the history on the initiative page."}
      </p>
      {edit && body === null && (
        <Status kind="wait" className="mt-4 max-w-[760px]">
          Your last edit is waiting for review. The form starts from it, and saving again replaces
          it.
        </Status>
      )}

      {body === null && r && base
        ? (
          <EditForm
            key={r.id}
            r={base}
            pledges={page.pledges}
            team={team}
            mine={mine}
            hold={hold}
          />
        )
        : (
          <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
            <div className="min-w-0">{body}</div>
            <StickyAside className="flex flex-col gap-3.5 max-[960px]:static max-[960px]:order-first">
              <WhatYouCanChange
                status={r?.status}
                manage={session?.isAdmin && r ? `/admin/initiatives/${r.slug}` : undefined}
              />
              <RevisionsCard hold={hold} />
            </StickyAside>
          </div>
        )}
    </PageMain>
  );
}

/** What can change, by status; an admin also gets the way to everything else (`manage`). */
function WhatYouCanChange(
  { status, manage }: { status?: Initiative["status"]; manage?: string },
) {
  return (
    <div className="panel">
      <span className="k">What you can change</span>
      <p className="m-0 small dim">
        {manage
          ? "As an admin you can change everything here, the facts locked after approval included. The same checks apply, and your edits are tagged as the team's."
          : status === "pending"
          ? "Everything you submitted can still be changed here. Backers are added by the team."
          : (
            <>
              Locked after approval: type, goal, duration, recipient and the private fields. Email
              {" "}
              <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> to change them.
            </>
          )}
      </p>
      {manage && (
        <LinkButton variant="ghost" className="mt-3 w-full" to={manage}>
          <Settings2 className="size-[15px]" />Manage initiative
        </LinkButton>
      )}
    </div>
  );
}

function RevisionsCard({ hold }: { hold: boolean }) {
  return (
    <div className="panel">
      <span className="k">Revisions</span>
      <p className="m-0 small dim">
        {hold
          ? "Once the team accepts it, your edit is a new revision with your wallet as its author."
          : "Each save is a new revision with your wallet as its author."}{" "}
        Older revisions stay readable, with a word-by-word view of what changed.
      </p>
    </div>
  );
}

function EditForm(
  { r, pledges, team, mine, hold }: {
    /** The row with the text the form starts from (the edit in review, if any). */
    r: Initiative;
    pledges: Pledge[];
    team: boolean;
    mine: boolean;
    /** Saving sends the edit for review instead of publishing it. */
    hold: boolean;
  },
) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requireSession } = useSession();
  // The facts lock on approval for the proposer, never for the team.
  const open = r.status === "pending" || team;
  // The team comes from the admin page and goes back to it.
  const back = team && !mine ? `/admin/initiatives/${r.slug}` : `/initiative/${r.slug}`;
  const initial = useMemo(() => fromInitiative(r, pledges), [r, pledges]);
  const path = `/api/initiatives/${encodeURIComponent(r.slug)}`;

  async function onSubmit(payload: SubmitPayload) {
    await requireSession();
    const facts = open ? pageFactsPatch(payload, r) : null;
    const text = textChanged(payload, r);
    // Categories are part of the proposal: they change with the text, in the revision.
    const cats = payload.categories.join() !== r.categories.join()
      ? { categories: payload.categories }
      : null;
    if (!facts && !text && !cats) throw new Error("Nothing changed.");
    let patched = false;
    try {
      if (facts) {
        await api(path, { method: "PATCH", json: { ...facts, initiativeId: r.id } });
        patched = true;
      }
      if (text || cats) {
        await api(`${path}/revisions`, {
          json: { ...(text ? textBody(payload) : null), ...cats, initiativeId: r.id },
        });
      }
    } catch (err) {
      // the facts are saved even when the text was refused: show the row as it is now
      if (patched) void qc.invalidateQueries({ queryKey: initiativeKey(r.slug) });
      throw err;
    }
    await qc.invalidateQueries({ queryKey: initiativeKey(r.slug) });
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["admin"] });
    void qc.invalidateQueries({ queryKey: ["mine"] });
    void qc.invalidateQueries({ queryKey: ["revision", r.slug] });
    navigate(back);
  }

  return (
    <InitiativeForm
      mode="edit"
      initial={initial}
      locked={!open}
      onSubmit={onSubmit}
      categories={{}}
      submitLabel={hold ? "Send edit for review" : "Save as a new revision"}
      showBackers={false}
      showPrivate={open}
      showTypePicker={open}
      showRules={false}
      autosaveKey={null}
      asideTop={
        <WhatYouCanChange
          status={r.status}
          manage={team ? `/admin/initiatives/${r.slug}` : undefined}
        />
      }
      asideBottom={<RevisionsCard hold={hold} />}
      footer={
        <p className="m-0 mt-3.5 text-center">
          <Link className="btn btn-ghost btn-sm" to={back}>Cancel</Link>
        </p>
      }
    />
  );
}
