/**
 * Editing an existing initiative: what of the form's payload differs from
 * the stored row. The page facts go to `PATCH /api/initiatives/:slug` (the
 * proposer while pending, an admin any time), the text to
 * `POST /api/initiatives/:slug/revisions`; both are skipped when nothing in
 * their half changed.
 */
import { normaliseStructured, sameStructured } from "@shared/draft/mod";
import type { SubmitPayload } from "~/components/initiative-form/types";
import type { Initiative } from "~/lib/api-types";

export const FACT_KEYS = [
  "type",
  "topup",
  "goal",
  "durationMonths",
  "recipientTeam",
  "recipientUrl",
  "milestoneReviewer",
  "discourseUrl",
  "funders",
  "contact",
] as const;

export type FactKey = (typeof FACT_KEYS)[number];
export type PageFacts = Pick<SubmitPayload, FactKey>;
export type PageFactsPatch = Partial<PageFacts>;

export type TextBody = Pick<
  SubmitPayload,
  "title" | "summary" | "sections" | "milestones" | "links"
>;

/** The row's page facts in the payload's shape. */
export function rowFacts(r: Initiative): PageFacts {
  const grant = r.type === "grant";
  const topup = grant && Boolean(r.topup);
  return {
    type: r.type,
    topup,
    goal: r.goalUsd ? String(r.goalUsd) : "",
    durationMonths: r.durationMonths ? String(r.durationMonths) : "",
    recipientTeam: grant ? r.recipientTeam ?? "" : "",
    recipientUrl: grant ? r.recipientUrl ?? "" : "",
    milestoneReviewer: topup ? r.milestoneReviewer ?? "" : "",
    discourseUrl: r.discourseUrl ?? "",
    funders: r.funders ?? "",
    contact: r.contact ?? "",
  };
}

/** The page facts that differ from the row, or null when none does. */
export function pageFactsPatch(payload: PageFacts, r: Initiative): PageFactsPatch | null {
  const was = rowFacts(r);
  const patch: PageFactsPatch = {};
  for (const k of FACT_KEYS) {
    if (payload[k] !== was[k]) (patch as Record<FactKey, unknown>)[k] = payload[k];
  }
  return Object.keys(patch).length ? patch : null;
}

/** The revision body: title, summary and the structured body. */
export function textBody(payload: TextBody): TextBody {
  const { title, summary, sections, milestones, links } = payload;
  return { title, summary, sections, milestones, links };
}

/** Whether the text half differs from the row. A legacy row (single text
 * body) always counts as changed: posting sections migrates it. */
export function textChanged(
  payload: TextBody & { type: Initiative["type"] },
  r: Initiative,
): boolean {
  if (payload.title !== r.title || payload.summary !== r.summary) return true;
  if (!r.structured) return true;
  return !sameStructured(
    normaliseStructured(payload, payload.type),
    { sections: r.sections ?? {}, milestones: r.milestones ?? [], links: r.links ?? [] },
  );
}
