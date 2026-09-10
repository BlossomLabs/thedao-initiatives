import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import Crumbs from "~/components/layout/Crumbs";
import PageMain from "~/components/layout/PageMain";
import Skeleton from "~/components/ui/Skeleton";
import { Field, Input, Textarea } from "~/components/ui/Field";
import { Button, LinkButton } from "~/components/ui/Button";
import Identity from "~/components/wallet/Identity";
import { useSession } from "~/context/session";
import { initiativeKey, useInitiative } from "~/hooks/use-initiative";
import { api, ApiError, errorMessage } from "~/lib/api";
import type { RevisionText } from "~/lib/api-types";
import { CONTACT_EMAIL, CONTACT_MAILTO, SITE_NAME } from "~/data/site";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Edit initiative" });
}

/**
 * The proposer's edit page: title, summary and details only. Saving writes a
 * new public revision that goes live at once; the old text stays browsable.
 * Admins may use it too (their edits are tagged as the team's).
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
  if (isLoading || (page && isPlaceholderData && !session)) {
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
    body = <EditForm slug={r.slug} initial={r} />;
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

      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">{body}</div>
        <aside className="sticky top-[86px] flex flex-col gap-3.5 max-[960px]:static max-[960px]:order-first">
          <div className="panel">
            <span className="k">What you can change</span>
            <p className="m-0 small dim">
              The title, the short summary and the full details. The funding goal, the forum link
              and the type are set by the team: email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
              {" "}
              to change those.
            </p>
          </div>
          <div className="panel">
            <span className="k">Revisions</span>
            <p className="m-0 small dim">
              Each save is a new revision with your wallet as its author. Older revisions stay
              readable, with a word-by-word view of what changed.
            </p>
          </div>
        </aside>
      </div>
    </PageMain>
  );
}

function EditForm({ slug, initial }: { slug: string; initial: RevisionText }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requireSession } = useSession();
  const [f, setF] = useState<RevisionText>({
    title: initial.title,
    summary: initial.summary,
    details: initial.details,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set =
    (k: keyof RevisionText) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));
  const dirty = f.title !== initial.title || f.summary !== initial.summary ||
    f.details !== initial.details;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await requireSession();
      await api(`/api/initiatives/${encodeURIComponent(slug)}/revisions`, { json: f });
      await qc.invalidateQueries({ queryKey: initiativeKey(slug) });
      void qc.invalidateQueries({ queryKey: ["board"] });
      navigate(`/initiative/${slug}`);
    } catch (err) {
      setError(errorMessage(err));
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="alert" role="alert">{error}</div>}
      <form className="flex flex-col" onSubmit={submit} noValidate>
        <Field label="Title" htmlFor="e-title" required className="mt-0">
          <Input id="e-title" maxLength={140} value={f.title} onChange={set("title")} required />
        </Field>
        <Field
          label="Short summary"
          htmlFor="e-summary"
          required
          hint="2 to 4 sentences: what gets built, why it matters."
        >
          <Textarea
            id="e-summary"
            className="min-h-[104px]"
            rows={4}
            maxLength={4000}
            value={f.summary}
            onChange={set("summary")}
            required
          />
        </Field>
        <Field
          label="Full initiative details"
          htmlFor="e-details"
          hint="Scope, milestones, budget breakdown. Markdown supported: headings, **bold**, lists, tables, - [ ] checklists."
        >
          <Textarea
            id="e-details"
            className="mono min-h-[320px] text-[13px] leading-[1.55]"
            rows={16}
            maxLength={20000}
            value={f.details}
            onChange={set("details")}
          />
        </Field>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
            <Save className="size-4" />Save as a new revision
          </Button>
          <Link className="btn btn-ghost" to={`/initiative/${slug}`}>Cancel</Link>
          {!dirty && <span className="small dim">Nothing changed yet.</span>}
        </div>
      </form>
    </>
  );
}
