/** "What happens next" side card, one paragraph per initiative type (v1 wording, verbatim). */
import type { InitiativeType } from "~/lib/api-types";

export const WHAT_NEXT: Record<InitiativeType, string> = {
  grant:
    "If backers and donors fully fund this initiative, the team has 15 days to finalize milestone terms and deadlines and they are paid out as they complete the milestones. If it hasn't reached its funding goal but has enough support to qualify for TheDAO's voting round near the end of the year, then the ETHSecurity Badge holders will rank it against the other initiatives and TheDAO Security Fund completes the funding for the top-voted initiatives.",
  rfp:
    "If backers and donors fully fund this initiative, a 30 day open RFP process begins, a team is chosen and they are paid out as they complete the milestones. If it hasn't reached its funding goal but has enough support to qualify for TheDAO's voting round near the end of the year, then the ETHSecurity Badge holders will rank it against the other initiatives and TheDAO Security Fund completes the funding for the top-voted initiatives.",
};
