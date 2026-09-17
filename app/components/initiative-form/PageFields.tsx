/**
 * The page fields: what renders in the header of the initiative page and on
 * the board card, never inside a body section.
 */
import { LIMITS } from "@shared/draft/mod";
import { Input, Textarea } from "~/components/ui/Field";
import AmountInput from "./AmountInput";
import FormField from "./FormField";
import type { Draft } from "./types";
import type { DraftActions } from "./useDraft";

export default function PageFields(
  { draft, actions, locked }: { draft: Draft; actions: DraftActions; locked?: boolean },
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
        hint='Up to 140 characters. No "RFP:" or "Grant:" prefix, the badge says it.'
      >
        <Input maxLength={LIMITS.TITLE_CHARS + 1} value={p.title} onChange={set("title")} />
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
          maxLength={LIMITS.SUMMARY_CHARS + 1}
          value={p.summary}
          onChange={set("summary")}
        />
      </FormField>
      <div className="grid grid-cols-[1fr_1fr] gap-x-4 max-[640px]:grid-cols-1">
        <FormField field="goal" label="Funding goal (USD)" required hint="One flat number.">
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
        <div className="grid grid-cols-[1fr_1fr] gap-x-4 max-[640px]:grid-cols-1">
          <FormField
            field="recipient_team"
            label="Recipient team"
            required
            hint='Short name for the header and the board card, as in "Grant to the OPSEC ratings coalition".'
          >
            <Input
              maxLength={LIMITS.RECIPIENT_CHARS + 1}
              value={p.recipientTeam}
              disabled={locked}
              onChange={set("recipientTeam")}
            />
          </FormField>
          <FormField
            field="recipient_url"
            label="Recipient link"
            hint="Optional https link to the team's site or repository."
          >
            <Input
              type="url"
              placeholder="https://"
              maxLength={LIMITS.LINK_CHARS + 1}
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
          maxLength={300}
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
