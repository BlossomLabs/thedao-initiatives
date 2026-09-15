/**
 * The milestone list with its totals line: the amounts add up against the
 * funding goal, and the adoption-tied share against its floor.
 */
import { usd } from "@shared/draft/mod";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/utils";
import { domId, edgeClass, FieldMsg, useFinding } from "./findings";
import MilestoneRow from "./MilestoneRow";
import type { Draft } from "./types";
import { adoptionLine, type Checks } from "./useChecks";
import type { DraftActions } from "./useDraft";

export default function MilestonesEditor(
  { draft, actions, totals, disabled }: {
    draft: Draft;
    actions: DraftActions;
    totals: Checks["totals"];
    disabled?: boolean;
  },
) {
  const f = useFinding("milestones");
  return (
    <div id={domId("milestones")} data-field="milestones" className={cn("mt-5", edgeClass(f))}>
      {draft.milestones.length
        ? (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {draft.milestones.map((m, i) => (
              <MilestoneRow
                key={m.id}
                m={m}
                i={i}
                topup={draft.type === "grant" && draft.topup}
                actions={actions}
                disabled={disabled}
                canRemove
              />
            ))}
          </ol>
        )
        : (
          <p className="m-0 small dim">
            No milestones yet. Add the first one, or paste a draft and we build the rows from it.
          </p>
        )}
      <FieldMsg field="milestones" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button
          variant="ghost"
          sm
          disabled={disabled}
          onClick={() => {
            const id = actions.addMilestone();
            setTimeout(() => {
              document.querySelector<HTMLInputElement>(
                `[data-field="ms_${draft.milestones.length}"] input`,
              )
                ?.focus();
            }, 0);
            return id;
          }}
        >
          Add milestone
        </Button>
        <div className="flex flex-col items-end gap-0.5 small tnum text-right">
          <span className={totals.ok ? "text-dao-green" : "text-[#ffd7d6]"}>
            Milestones total {usd(totals.sum)} of {usd(totals.goal)} goal
          </span>
          <span className={totals.adoptionOk ? "text-dao-green" : "text-[#ffd7d6]"}>
            Adoption-tied: {adoptionLine(totals)}
          </span>
        </div>
      </div>
    </div>
  );
}
