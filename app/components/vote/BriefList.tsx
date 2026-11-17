import { ofGoal, paidOnAdoption, type VoteBrief } from "../../../shared/vote/brief";
import BackerLogo from "~/components/ui/BackerLogo";
import { usd } from "~/lib/format";
import { useVoteBriefs } from "~/hooks/use-vote-briefs";
import { cn } from "~/lib/utils";
import type { BallotItem } from "./TierBallot";

/** An initiative's card text on /vote (#96), never the long form: what it delivers in
 * one to three bullets, each under a short bold title; "Adoption:" with up to three
 * sub-bullets; then "Paid on adoption" (the milestones' own). The written bullets show
 * once the model has written them (when an admin approves the initiative or accepts an
 * edit). While they load: grey bars. If they can't be read (or
 * the initiative has none, a mock round's), the summary stands in. */
export default function BriefList(
  { item, className }: { item: BallotItem; className?: string },
) {
  const briefs = useVoteBriefs();
  const brief = briefs.data?.[item.slug];
  const summary = item.card?.initiative.summary;
  if (briefs.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading" className={cn("flex flex-col gap-2.5", className)}>
        {[92, 70, 84, 60].map((w) => (
          <span
            key={w}
            className="h-3 animate-pulse rounded bg-white/[.07]"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );
  }
  if (!brief) {
    return summary
      ? <p className={cn("m-0 leading-relaxed text-white/75", className)}>{summary}</p>
      : null;
  }
  return <BriefBullets brief={brief} className={className} />;
}

/** The bullets themselves: what it delivers, each under its bold title; "Adoption:" with
 * its sub-bullets; "Paid on adoption". The vote card and the admin's initiative page. */
export function BriefBullets({ brief, className }: { brief: VoteBrief; className?: string }) {
  return (
    <ul data-brief="" className={cn("m-0 flex list-none flex-col gap-1.5 p-0", className)}>
      {brief.what?.map((w, i) => (
        <Bullet key={i}>
          <b className="font-semibold text-white">{w.title}:</b> {w.text}
        </Bullet>
      ))}
      {brief.adoption && (
        <Bullet>
          <b className="font-semibold text-white">Adoption:</b>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {brief.adoption.map((a, i) => <Bullet key={i} sub>{a}</Bullet>)}
          </ul>
        </Bullet>
      )}
      <Bullet>
        <b className="font-semibold text-white">Paid on adoption:</b>{" "}
        <span className="tnum">{paidOnAdoption(brief)}</span>
      </Bullet>
    </ul>
  );
}

/** A dot and its text; a sub-bullet's dot is a small ring. */
function Bullet({ children, sub }: { children: React.ReactNode; sub?: boolean }) {
  return (
    <li className="relative pl-3.5 leading-snug text-white/75">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-[.6em] size-[5px] rounded-full",
          sub ? "border border-white/40" : "bg-white/30",
        )}
      />
      {children}
    </li>
  );
}

/** The card's header: "$199,000 ask (75% of goal)"; "$199,000 ask" without a goal. */
export function askText(item: BallotItem): string {
  if (item.askUsd === undefined) return "";
  const share = ofGoal(item.askUsd, item.card?.initiative.goalUsd ?? 0);
  return `${usd(item.askUsd)} ask${share ? ` (${share})` : ""}`;
}

/** The pledgers, a very small stack of their logos (silhouettes without one), as the
 * board's: the card carries up to four. Names in each logo's title. */
export function PledgerStack(
  { item, size = 16, className }: { item: BallotItem; size?: 16 | 20 | 32; className?: string },
) {
  const logos = item.card?.logos ?? [];
  if (!logos.length) return null;
  return (
    <span
      data-pledgers=""
      className={cn("flex flex-none items-center", className)}
      aria-label={`Pledged by ${logos.map((l) => l.company).join(", ")}`}
      role="img"
    >
      {logos.map((l, i) => (
        <span key={i} className={cn("flex first:ml-0", size === 32 ? "-ml-2" : "-ml-1")}>
          <BackerLogo
            logoUrl={l.logoUrl}
            company={l.company}
            className={cn(
              "p-px ring-2 ring-panel-modal",
              size === 16
                ? "size-4 [&>svg]:size-2.5"
                : size === 20
                ? "size-5 [&>svg]:size-3"
                : "size-8 [&>svg]:size-4",
            )}
          />
        </span>
      ))}
    </span>
  );
}
