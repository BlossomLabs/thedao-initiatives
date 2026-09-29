import { useEffect, useMemo } from "react";
import StickyAside from "~/components/layout/StickyAside";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import Crumbs from "~/components/layout/Crumbs";
import PageMain from "~/components/layout/PageMain";
import Skeleton from "~/components/ui/Skeleton";
import { LinkButton } from "~/components/ui/Button";
import Identity from "~/components/wallet/Identity";
import InitiativeForm from "~/components/initiative-form/InitiativeForm";
import type { SubmitPayload } from "~/components/initiative-form/types";
import { fromInitiative } from "~/components/initiative-form/useDraft";
import { useSession } from "~/context/session";
import { initiativeKey, useInitiative } from "~/hooks/use-initiative";
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
 * milestones, links, title and summary are always editable and every save is
 * a new public revision. While the initiative is pending the page facts
 * (type, goal, duration, recipient, reviewer, forum link) and the private
 * fields can change too; after approval those belong to the team. It is the
 * team's editor as well: an admin works under the same rules, tagged as the
 * team, and the facts are never locked for them.
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
  const allowed = mine || Boolean(session?.isAdmin);
  const open = r?.status === "pending" || r?.status === "approved";

  let body: React.ReactNode;
  // the board placeholder has no pledges, and the form reads its draft once
  if (isLoading || isPlaceholderData) {
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
        Changes go live as soon as you save. Every version is kept and anyone can browse the history
        on the initiative page.
      </p>

      {body === null && r
        ? (
          <EditForm
            key={r.id}
            r={r}
            pledges={page.pledges}
            team={Boolean(session?.isAdmin)}
            mine={mine}
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
              <RevisionsCard />
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

function RevisionsCard() {
  return (
    <div className="panel">
      <span className="k">Revisions</span>
      <p className="m-0 small dim">
        Each save is a new revision with your wallet as its author. Older revisions stay readable,
        with a word-by-word view of what changed.
      </p>
    </div>
  );
}

function EditForm(
  { r, pledges, team, mine }: { r: Initiative; pledges: Pledge[]; team: boolean; mine: boolean },
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
    // Categories follow the text: editable while it is, outside the revision.
    const cats = payload.categories.join() !== r.categories.join()
      ? { categories: payload.categories }
      : null;
    if (!facts && !text && !cats) throw new Error("Nothing changed.");
    let patched = false;
    try {
      if (facts || cats) {
        await api(path, { method: "PATCH", json: { ...facts, ...cats, initiativeId: r.id } });
        patched = true;
      }
      if (text) {
        await api(`${path}/revisions`, { json: { ...textBody(payload), initiativeId: r.id } });
      }
    } catch (err) {
      // the facts are saved even when the text was refused: show the row as it is now
      if (patched) void qc.invalidateQueries({ queryKey: initiativeKey(r.slug) });
      throw err;
    }
    await qc.invalidateQueries({ queryKey: initiativeKey(r.slug) });
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["admin"] });
    navigate(back);
  }

  return (
    <InitiativeForm
      mode="edit"
      initial={initial}
      locked={!open}
      onSubmit={onSubmit}
      categories={{}}
      submitLabel="Save as a new revision"
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
      asideBottom={<RevisionsCard />}
      footer={
        <p className="m-0 mt-3.5 text-center">
          <Link className="btn btn-ghost btn-sm" to={back}>Cancel</Link>
        </p>
      }
    />
  );
}
