/**
 * RFP or grant, as two radio cards; a grant may be a top-up (work already
 * under way with another funder), which asks for the milestone reviewer.
 */
import { Input } from "~/components/ui/Field";
import { cn } from "~/lib/utils";
import type { DraftType } from "@shared/draft/mod";
import FormField from "./FormField";
import type { Draft } from "./types";
import type { DraftActions } from "./useDraft";

const TYPES: { id: DraftType; label: string; sub: string }[] = [
  { id: "rfp", label: "RFP", sub: "An open request: any qualified team can bid to do the work." },
  { id: "grant", label: "Grant", sub: "Your team presents the idea and does the work." },
];

export default function TypePicker(
  { draft, actions, locked }: { draft: Draft; actions: DraftActions; locked?: boolean },
) {
  return (
    <div className="mt-3" data-field="type">
      <span className="label">Type *</span>
      <div className="mt-1.5 flex flex-wrap gap-2.5">
        {TYPES.map((t) => (
          <label
            key={t.id}
            className={cn(
              "flex min-w-[220px] flex-1 items-start gap-2.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-3 transition-colors duration-150",
              locked
                ? "cursor-default opacity-70"
                : "cursor-pointer hover:border-[rgba(92,183,90,.45)]",
              draft.type === t.id && "border-dao-green shadow-[0_0_14px_rgba(92,183,90,.12)]",
            )}
          >
            <input
              type="radio"
              name="type"
              value={t.id}
              checked={draft.type === t.id}
              disabled={locked}
              onChange={() => actions.setType(t.id)}
              className="mt-[3px]"
            />
            <span>
              <b
                className={cn(
                  "block font-inter-tight text-[13.5px] font-semibold",
                  draft.type === t.id && "text-dao-green",
                )}
              >
                {t.label}
              </b>
              <small className="mt-0.5 block text-[12px] leading-[1.5] text-muted">{t.sub}</small>
            </span>
          </label>
        ))}
      </div>
      {draft.type === "grant" && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3">
          <label className="flex cursor-pointer items-start gap-2.5 font-inter-tight text-[14px]">
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={draft.topup}
              disabled={locked}
              onChange={(e) => actions.setTopup(e.target.checked)}
            />
            <span>Work is already under way with another funder</span>
          </label>
          <p className="hint m-0">
            This makes it a top-up. No proposal window. Completed milestones get a link to the
            delivered work, and every remaining one carries a target month.
          </p>
          {draft.topup && (
            <FormField
              field="milestone_reviewer"
              label="Milestone reviewer"
              hint="Who decides whether the remaining milestones pass: a named engineer and their affiliation."
              className="mt-3.5 first:mt-3.5"
            >
              <Input
                maxLength={200}
                value={draft.milestoneReviewer}
                disabled={locked}
                onChange={(e) => actions.setReviewer(e.target.value)}
              />
            </FormField>
          )}
        </div>
      )}
    </div>
  );
}
