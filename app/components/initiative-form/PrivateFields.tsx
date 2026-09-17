import { inputMax, LIMITS } from "@shared/draft/mod";
import { Input, Textarea } from "~/components/ui/Field";
import FormField from "./FormField";
import type { Draft } from "./types";
import type { DraftActions } from "./useDraft";

/** The two fields only the review team reads. */
export default function PrivateFields(
  { draft, actions, locked }: { draft: Draft; actions: DraftActions; locked?: boolean },
) {
  return (
    <>
      <FormField
        field="funders"
        label="Who is likely to fund this?"
        required
        privateField
        hint="One funder per line: name | why they care | your relationship | warm intro? | likely amount."
      >
        <Textarea
          rows={6}
          maxLength={inputMax(LIMITS.FUNDERS_CHARS)}
          placeholder="Ethereum Foundation | funds public-goods security tooling | met once | warm intro? yes | $50,000"
          value={draft.priv.funders}
          disabled={locked}
          onChange={(e) => actions.setPriv("funders", e.target.value)}
        />
      </FormField>
      <FormField
        field="contact"
        label="Contact"
        required
        privateField
        hint="Email or handle. We use it only to ask about this submission."
      >
        <Input
          maxLength={inputMax(LIMITS.CONTACT_CHARS)}
          value={draft.priv.contact}
          disabled={locked}
          onChange={(e) => actions.setPriv("contact", e.target.value)}
        />
      </FormField>
    </>
  );
}
