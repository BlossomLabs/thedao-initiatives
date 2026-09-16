import { Link, useLocation } from "react-router";
import PageMain from "~/components/layout/PageMain";
import { LinkButton } from "~/components/ui/Button";
import { RULES, type RulesKind } from "~/data/rules";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Thank you", url: "/submit/thanks", noIndex: true });
}

export interface SubmittedState {
  title?: string;
  slug?: string;
  kind?: RulesKind;
  warnings?: { field: string; msg: string }[];
}

/** One sentence on what the kind's process looks like once it is funded. */
export const KIND_NEXT: Record<RulesKind, string> = {
  rfp:
    "Once it is approved and funded, a 30-day proposal window opens and any qualified team can bid to do the work.",
  grant:
    "Once it is approved and funded, your team has 15 days to finalize the milestone terms and deadlines, and is paid out as the milestones complete.",
  topup:
    "A top-up has no proposal window: once it is approved and funded, the remaining milestones are paid out as the reviewer passes them.",
};

export default function Submitted() {
  const state = (useLocation().state as SubmittedState | null) ?? {};
  const { title, slug, kind, warnings } = state;
  const n = warnings?.length ?? 0;
  return (
    <PageMain narrow detail center className="min-h-[50vh]">
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        Thank you
      </h1>
      <p className="mt-3.5 font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        {title ? <b className="text-white">{title}</b> : "Your initiative"}{" "}
        is in the review queue. Once an admin approves it, it will appear on the initiatives board
        and can start collecting pledges and donations.
      </p>
      {kind && (
        <p className="small dim">
          The site adds the "{RULES[kind].title}" panel under your text, so the process, the
          reviewer and the payment terms never need to be part of what you wrote. {KIND_NEXT[kind]}
        </p>
      )}
      {n > 0 && (
        <p className="small dim">
          You submitted past {n} warning{n === 1 ? "" : "s"}. The reviewer sees the same list.
        </p>
      )}
      <p className="flex flex-wrap items-center justify-center gap-2.5">
        {slug && (
          <LinkButton variant="primary" to={`/initiative/${slug}`}>
            See your initiative (pending review)
          </LinkButton>
        )}
        <Link className="btn" to="/mine">All your submissions</Link>
        <Link className="btn" to="/">Back to the board</Link>
      </p>
    </PageMain>
  );
}
