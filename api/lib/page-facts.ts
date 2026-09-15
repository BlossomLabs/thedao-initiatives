/**
 * The page facts an editor may change outside the revisioned text: type,
 * top-up, goal, duration, recipient, reviewer, forum link and the two private
 * fields. One reader for the admin editor and the proposer's PATCH (allowed
 * while the row is pending). Grant-only fields are cleared when the row is
 * (or becomes) an RFP, and the reviewer when it is not a top-up, so a type
 * switch never leaves stale facts behind.
 */
import type { Rfp } from "../db/types.ts";
import type { Deps } from "../middleware/context.ts";
import { HttpError } from "./errors.ts";
import { s } from "./body.ts";
import { parseDuration, parseGoal, validateForumUrl, validateHttpsLink } from "./validate.ts";
import { MAX_FUNDERS } from "../config.ts";

export async function readPageFacts(
  body: Record<string, unknown>,
  current: Rfp,
  deps: Pick<Deps, "resolve">,
): Promise<Partial<Rfp>> {
  const patch: Partial<Rfp> = {};
  if (body.goal !== undefined || body.goalUsd !== undefined) {
    const [goal, err] = parseGoal(body.goalUsd ?? body.goal);
    if (err) throw new HttpError(400, err);
    patch.goalUsd = goal!;
  }
  if (body.discourseUrl !== undefined) {
    const raw = s(body.discourseUrl, 500);
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
      ? s(body.recipientTeam ?? current.recipientTeam ?? "", 120)
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
      ? s(body.milestoneReviewer ?? current.milestoneReviewer ?? "", 200)
      : "";
  }
  if (body.contact !== undefined) patch.contact = s(body.contact, 200);
  if (body.funders !== undefined) patch.funders = s(body.funders, MAX_FUNDERS);
  return patch;
}
