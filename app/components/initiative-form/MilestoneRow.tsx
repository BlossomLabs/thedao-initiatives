/**
 * One milestone card: letter, name, amount, the adoption flag, and on a
 * top-up the done flag with its delivered link (done) or target month (not
 * done), then the criteria list.
 */
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Field";
import Letter from "~/components/ui/Letter";
import { inputMax, letter, LIMITS } from "@shared/draft/mod";
import AmountInput from "./AmountInput";
import CriteriaList from "./CriteriaList";
import FormField from "./FormField";
import type { DraftMilestone } from "./types";
import type { DraftActions } from "./useDraft";

export default function MilestoneRow(
  { m, i, topup, actions, disabled, canRemove }: {
    m: DraftMilestone;
    i: number;
    topup: boolean;
    actions: DraftActions;
    disabled?: boolean;
    canRemove: boolean;
  },
) {
  const p = `ms_${i}_`;
  const set = (patch: Partial<Omit<DraftMilestone, "id" | "criteria">>) =>
    actions.setMilestone(m.id, patch);
  return (
    <li className="rounded-2xl border border-edge bg-card px-5 py-4" data-field={`ms_${i}`}>
      <div className="flex items-center gap-3">
        <Letter i={i} done={topup && m.done} />
        <span className="k m-0 flex-1">Milestone {letter(i)}</span>
        {canRemove && (
          <Button
            variant="ghost"
            sm
            disabled={disabled}
            onClick={() => actions.removeMilestone(m.id)}
          >
            Remove
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[1fr_200px] gap-x-4 max-[640px]:grid-cols-1">
        <FormField field={p + "name"} label="Name" required className="mt-3.5 first:mt-3.5">
          <Input
            maxLength={inputMax(LIMITS.MILESTONE_NAME)}
            value={m.name}
            disabled={disabled}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FormField>
        <FormField
          field={p + "amount"}
          label="Amount (USD)"
          required
          className="mt-3.5 first:mt-3.5"
        >
          {(props) => (
            <AmountInput
              {...props}
              placeholder="50,000"
              value={m.amount}
              disabled={disabled}
              onChange={(v) => set({ amount: v })}
            />
          )}
        </FormField>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2 font-inter-tight text-[14px]">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            id={`f-${p}adoption`}
            checked={m.adoption}
            disabled={disabled}
            onChange={(e) => set({ adoption: e.target.checked })}
          />
          Adoption milestone
        </label>
        {topup && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              id={`f-${p}done`}
              checked={m.done}
              disabled={disabled}
              onChange={(e) => set({ done: e.target.checked })}
            />
            Already done
          </label>
        )}
      </div>
      {topup && m.done && (
        <FormField field={p + "link"} label="Link to the delivered work" className="mt-3">
          <Input
            type="url"
            placeholder="https://"
            maxLength={inputMax(LIMITS.LINK_CHARS)}
            value={m.link}
            disabled={disabled}
            onChange={(e) =>
              set({ link: e.target.value })}
          />
        </FormField>
      )}
      {topup && !m.done && (
        <FormField field={p + "month"} label="Target month" className="mt-3">
          <Input
            type="month"
            className="max-w-[220px]"
            value={m.month}
            disabled={disabled}
            onChange={(e) => set({ month: e.target.value })}
          />
        </FormField>
      )}
      <CriteriaList
        msIndex={i}
        msId={m.id}
        criteria={m.criteria}
        disabled={disabled}
        onSet={actions.setCriterion}
        onInsert={actions.insertCriterion}
        onRemove={actions.removeCriterion}
      />
    </li>
  );
}
