import { CalendarDays, ExternalLink } from "lucide-react";
import { adoptionTotal, letter, type Milestone, milestonesTotal, usd } from "@shared/draft/mod";
import SectionHeading from "~/components/layout/SectionHeading";
import Markdown from "~/components/Markdown";
import Letter from "~/components/ui/Letter";
import { DiffBlock } from "~/components/initiative/RevisionBar";
import type { InitiativeType } from "~/lib/api-types";
import { monthLabel, plural } from "~/lib/format";
import type { TextDiff } from "~/lib/revision-diff";
import { httpsHref } from "~/lib/utils";

/**
 * The milestone list of a structured initiative: one lettered card per row
 * with amount, chips and acceptance criteria as a checkbox list. Done state,
 * target months and delivered links only mean something on a top-up grant.
 */
export default function Milestones(
  { type, topup, milestones, diff }: {
    type: InitiativeType;
    topup: boolean;
    milestones: Milestone[];
    diff?: Pick<TextDiff, "milestones"> | null;
  },
) {
  const title = type === "grant" ? "Milestones" : "Milestones (draft)";
  if (diff) {
    if (!diff.milestones.length) return null;
    return (
      <>
        <SectionHeading id="milestones">{title}</SectionHeading>
        <DiffBlock chunks={diff.milestones} className="mono text-[13px]" />
      </>
    );
  }
  if (!milestones.length) return null;
  const total = milestonesTotal(milestones);
  const adoption = adoptionTotal(milestones);
  const share = total > 0 ? Math.round((100 * adoption) / total) : 0;
  return (
    <>
      <SectionHeading id="milestones" count={milestones.length}>{title}</SectionHeading>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {milestones.map((m, i) => {
          const done = topup && m.done;
          const delivered = done ? httpsHref(m.link) : "";
          return (
            <li
              key={i}
              id={"milestone-" + letter(i)}
              className="rounded-2xl border border-edge bg-card px-5 py-4"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Letter i={i} done={done} />
                <h3 className="m-0 font-inter-tight text-[15px] font-semibold text-white">
                  {m.name}
                </h3>
                <span className="mono tnum text-[13px] text-dao-green">{usd(m.amount || 0)}</span>
                {m.adoption && <span className="chip st-approved">adoption milestone</span>}
                {topup && (done
                  ? <span className="chip st-approved">done</span>
                  : m.month && (
                    <span className="chip">
                      <CalendarDays className="mr-1 inline size-3 align-[-2px]" />
                      target {monthLabel(m.month)}
                    </span>
                  ))}
              </div>
              {m.criteria.length > 0 && (
                <Markdown
                  className="mt-2.5 max-w-none text-[14.5px]"
                  text={m.criteria.map((c) => `- [${done ? "x" : " "}] ${c}`).join("\n")}
                />
              )}
              {delivered && (
                <a
                  className="mt-1 inline-flex items-center gap-1.5 small"
                  href={delivered}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-3.5" />
                  Delivered: {m.link}
                </a>
              )}
            </li>
          );
        })}
      </ol>
      <p className="m-0 mt-2.5 small dim tnum">
        {plural(milestones.length, "milestone")}, {usd(total)} total
        {adoption > 0 && `; ${usd(adoption)} (${share}%) tied to adoption`}
      </p>
    </>
  );
}
