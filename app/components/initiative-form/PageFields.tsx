/**
 * The page fields: what renders in the header of the initiative page and on
 * the board card, never inside a body section.
 */
import { inputMax, LIMITS } from "@shared/draft/mod";
import { Input, Textarea } from "~/components/ui/Field";
import AmountInput from "./AmountInput";
import CategoryField from "./CategoryField";
import FormField from "./FormField";
import type { Draft } from "./types";
import type { DraftActions } from "./useDraft";

/**
 * Two fields side by side. Each one lays its label, control and message on
 * the row's own grid lines, so the controls line up when one hint wraps.
 */
const PAIR = "grid grid-cols-[1fr_1fr] gap-x-4 max-[640px]:grid-cols-1";
const PAIRED = "row-span-3 grid grid-rows-subgrid first:mt-[18px]";

export default function PageFields(
  { draft, actions, locked, categories }: {
    draft: Draft;
    actions: DraftActions;
    locked?: boolean;
    /** Show the categories question after the summary. */
    categories?: { suggest?: boolean };
  },
) {
  const p = draft.page;
  const set = (key: keyof Draft["page"]) =>
  (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => actions.setPage(key, e.target.value);
  return (
    <>
      <FormField
        field="title"
        label="Title"
        required
        hint={`Up to ${LIMITS.TITLE_CHARS} characters. No "RFP:" or "Grant:" prefix, the badge says it.`}
      >
        <Input maxLength={inputMax(LIMITS.TITLE_CHARS)} value={p.title} onChange={set("title")} />
      </FormField>
      <FormField
        field="summary"
        label="Short summary"
        required
        hint="2 to 4 sentences. This is the text on the board card."
      >
        <Textarea
          className="min-h-[104px]"
          rows={5}
          maxLength={inputMax(LIMITS.SUMMARY_CHARS)}
          value={p.summary}
          onChange={set("summary")}
        />
      </FormField>
      {categories && <CategoryField draft={draft} actions={actions} suggest={categories.suggest} />}
      <div className={PAIR}>
        <FormField
          field="goal"
          label="Funding goal (USD)"
          required
          hint="One flat number."
          className={PAIRED}
        >
          {(props) => (
            <AmountInput
              {...props}
              placeholder="250,000"
              value={p.goal}
              disabled={locked}
              onChange={(v) => actions.setPage("goal", v)}
            />
          )}
        </FormField>
        <FormField
          field="duration_months"
          label="Expected duration (months)"
          required
          hint="Months from funding until the last milestone is complete."
          className={PAIRED}
        >
          <Input
            className="mono text-[14px]"
            inputMode="numeric"
            placeholder="12"
            maxLength={3}
            value={p.duration}
            disabled={locked}
            onChange={set("duration")}
          />
        </FormField>
      </div>
      {draft.type === "grant" && (
        <div className={PAIR}>
          <FormField
            field="recipient_team"
            label="Recipient team"
            required
            hint="Short name for the header and the board card."
            className={PAIRED}
          >
            <Input
              placeholder="OPSEC ratings coalition"
              maxLength={inputMax(LIMITS.RECIPIENT_CHARS)}
              value={p.recipientTeam}
              disabled={locked}
              onChange={set("recipientTeam")}
            />
          </FormField>
          <FormField
            field="recipient_url"
            label="Recipient link"
            hint="Optional https link to the team's site or repository."
            className={PAIRED}
          >
            <Input
              type="url"
              placeholder="https://"
              maxLength={inputMax(LIMITS.LINK_CHARS)}
              value={p.recipientUrl}
              disabled={locked}
              onChange={set("recipientUrl")}
            />
          </FormField>
        </div>
      )}
      <FormField
        field="discourse_url"
        label="Discussion link"
        hint="Optional Discourse topic or Telegram group where this initiative is discussed."
      >
        <Input
          type="url"
          placeholder="https://forum.example.org/t/my-initiative/123"
          maxLength={inputMax(LIMITS.LINK_CHARS)}
          value={p.discourseUrl}
          disabled={locked}
          onChange={set("discourseUrl")}
        />
      </FormField>
      <FormField
        field="links"
        label="Other links"
        hint="Optional. Repo, site, prior write-up. One per line."
      >
        <Textarea
          rows={3}
          spellCheck={false}
          className="mono min-h-0 text-[13.5px]"
          value={p.links}
          onChange={set("links")}
        />
      </FormField>
    </>
  );
}
