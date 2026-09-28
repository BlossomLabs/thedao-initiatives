/**
 * The page facts an editor may change outside the revisioned text: type,
 * top-up, goal, duration, recipient, reviewer, forum link and the two private
 * fields. One reader for the admin editor and the proposer's PATCH (allowed
 * while the row is pending). Grant-only fields are cleared when the row is
 * (or becomes) an RFP, and the reviewer when it is not a top-up, so a type
 * switch never leaves stale facts behind.
 */
import type { Initiative } from "../db/types.ts";
import type { Deps } from "../middleware/context.ts";
import { HttpError } from "./errors.ts";
import { s } from "./body.ts";
import {
  capped,
  parseDuration,
  parseGoal,
  validateForumUrl,
  validateHttpsLink,
} from "./validate.ts";
import { MAX_FUNDERS } from "../config.ts";
import { LIMITS } from "../../shared/draft/mod.ts";
import { readCategories } from "../../shared/categories.ts";

export const PAGE_FACT_FIELDS = [
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
  "categories",
] as const;

export async function readPageFacts(
  body: Record<string, unknown>,
  current: Initiative,
  deps: Pick<Deps, "resolve">,
): Promise<Partial<Initiative>> {
  const patch: Partial<Initiative> = {};
  if (body.goal !== undefined) {
    const [goal, err] = parseGoal(body.goal);
    if (err) throw new HttpError(400, err);
    patch.goalUsd = goal!;
  }
  if (body.discourseUrl !== undefined) {
    const raw = s(body.discourseUrl, LIMITS.LINK_CHARS + 1);
    if (raw) {
      const [clean, err] = await validateForumUrl(raw, deps.resolve);
      if (err) throw new HttpError(400, err);
      patch.discourseUrl = clean!;
    } else patch.discourseUrl = "";
  }
  if (body.type !== undefined) patch.type = body.type === "grant" ? "grant" : "rfp";
  if (body.durationMonths !== undefined) {
    const [n, err] = parseDuration(body.durationMonths);
    if (err) throw new HttpError(400, err);
    patch.durationMonths = n;
  }
  const nextType = patch.type ?? current.type;
  if (body.recipientTeam !== undefined || nextType !== current.type) {
    patch.recipientTeam = nextType === "grant"
      ? capped(
        body.recipientTeam ?? current.recipientTeam ?? "",
        LIMITS.RECIPIENT_CHARS,
        "The recipient team",
      )
      : "";
  }
  if (body.recipientUrl !== undefined || nextType !== current.type) {
    const [clean, err] = validateHttpsLink(
      nextType === "grant" ? body.recipientUrl ?? current.recipientUrl ?? "" : "",
    );
    if (err) throw new HttpError(400, `Recipient link: ${err}`);
    patch.recipientUrl = clean!;
  }
  if (body.topup !== undefined || nextType !== current.type) {
    patch.topup = nextType === "grant" && Boolean(body.topup ?? current.topup);
  }
  const nextTopup = patch.topup ?? Boolean(current.topup);
  if (body.milestoneReviewer !== undefined || nextTopup !== Boolean(current.topup)) {
    patch.milestoneReviewer = nextTopup
      ? capped(
        body.milestoneReviewer ?? current.milestoneReviewer ?? "",
        LIMITS.REVIEWER_CHARS,
        "The reviewer",
      )
      : "";
  }
  if (body.contact !== undefined) {
    patch.contact = capped(body.contact, LIMITS.CONTACT_CHARS, "The contact");
  }
  if (body.funders !== undefined) {
    patch.funders = capped(body.funders, MAX_FUNDERS, "The funder list");
  }
  if (body.categories !== undefined) patch.categories = categoriesOr400(body.categories);
  return patch;
}

/** A category list from a request body, or a 400 with the reason. */
export function categoriesOr400(raw: unknown): string[] {
  const [list, err] = readCategories(raw);
  if (err) throw new HttpError(400, err);
  return list!;
}
