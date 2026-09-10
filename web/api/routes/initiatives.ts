import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { requireAuth } from "../middleware/auth.ts";
import { donationJson, pledgeJson, publicRfp, revisionJson, revisionMeta } from "../lib/json.ts";
import { parseGoal, validateForumUrl, validateText } from "../lib/validate.ts";
import { pctOf } from "./board.ts";
import { onrampLink } from "../lib/onramp.ts";
import { fetchDiscourseTitle } from "../services/forum.ts";
import {
  MAX_FUNDERS,
  REVISIONS_PER_HOUR_PER_ADDRESS,
  SUBMISSIONS_PER_HOUR_PER_IP,
  TOKENS,
} from "../config.ts";
import type { Rfp, Session } from "../db/types.ts";

export { onrampLink };
export const decimalsOf = (sym: string): number | undefined => TOKENS[sym]?.[1];

export function initiativeRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  /** Site nickname or ENS primary name (ENS answers are cached server-side). */
  const hasDisplayName = async (address: string) =>
    Boolean((await db.profiles.get(address)).nickname) ||
    Boolean((await deps.ens.reverse(address)).name);

  const isProposer = (rfp: Rfp, user: Session | null) =>
    Boolean(user && rfp.proposer && rfp.proposer.toLowerCase() === user.address.toLowerCase());

  /** Published rows for everyone; a pending one for its proposer and admins (so it can be edited). */
  const visibleOr404 = async (slug: string, user: Session | null): Promise<Rfp> => {
    const rfp = await db.rfps.bySlug(slug);
    const ok = rfp && (
      ["approved", "archived"].includes(rfp.status) ||
      (rfp.status === "pending" && (user?.isAdmin || isProposer(rfp, user)))
    );
    if (!ok) throw new HttpError(404, "not found");
    return rfp;
  };

  r.get("/:slug", async (c) => {
    const user = c.var.user;
    const rfp = await visibleOr404(c.req.param("slug"), user);
    const [summary, pledges, donations, active, revisions] = await Promise.all([
      db.fundingSummary(rfp.id),
      db.pledges.list(rfp.id),
      db.donations.list(rfp.id),
      deps.chain.activeTokens(),
      db.revisions.list(rfp.id, Boolean(user?.isAdmin)),
    ]);
    return c.json({
      initiative: publicRfp(rfp),
      revisions: revisions.map(revisionMeta),
      summary,
      pct: pctOf(summary.total, rfp.goalUsd),
      pledges: pledges.map((p) => pledgeJson(config, p)),
      donations: donations.map((d) => donationJson(d, decimalsOf)),
      funded: Boolean(rfp.goalUsd && summary.total >= rfp.goalUsd),
      donationsEnabled: Boolean(
        Object.keys(active).length && rfp.safeAddress && rfp.status === "approved",
      ),
      onramp: rfp.safeAddress ? onrampLink(config, rfp.safeAddress) : { url: "", prefilled: false },
    });
  });

  /** One version of the text as it was published; archived ones are for admins only. */
  r.get("/:slug/revisions/:n", async (c) => {
    const user = c.var.user;
    const rfp = await visibleOr404(c.req.param("slug"), user);
    const n = Number(c.req.param("n"));
    const rev = Number.isInteger(n) && n > 0 ? await db.revisions.get(rfp.id, n) : null;
    if (!rev || (rev.archived && !user?.isAdmin)) throw new HttpError(404, "not found");
    return c.json({ revision: revisionJson(rev) });
  });

  /**
   * The proposer (or an admin) replaces the title, summary and details. Goes
   * live at once; the previous text stays in the history.
   */
  r.post("/:slug/revisions", requireAuth, async (c) => {
    const user = c.var.user!;
    const rfp = await visibleOr404(c.req.param("slug"), user);
    const proposer = isProposer(rfp, user);
    if (!proposer && !user.isAdmin) {
      throw new HttpError(403, "Only the proposer can edit this initiative.");
    }
    if (rfp.status !== "pending" && rfp.status !== "approved") {
      throw new HttpError(403, "This initiative is no longer open for edits.");
    }
    if (
      !(await db.rateLimit(
        "revise:" + user.address.toLowerCase(),
        REVISIONS_PER_HOUR_PER_ADDRESS,
        3600,
      ))
    ) {
      throw new HttpError(429, "Too many edits; try again in an hour.");
    }
    const body = await jsonBody(c);
    const text = validateText({
      title: s(body.title),
      summary: s(body.summary),
      details: s(body.details, 100_000),
    });
    const { rfp: next, revision } = await db.rfps.revise(rfp.id, text, {
      author: user.address,
      source: proposer ? "proposer" : "admin",
    });
    if (!revision) throw new HttpError(400, "Nothing changed.");
    return c.json({ initiative: publicRfp(next), revision: revisionMeta(revision) }, 201);
  });

  /**
   * Submission from a signed-in wallet that has a display name (ENS primary
   * name or site nickname); always lands as pending for admin review.
   */
  r.post("/", requireAuth, async (c) => {
    const proposer = c.var.user!.address;
    const body = await jsonBody(c);
    if (s(body.website)) throw new HttpError(400, "bad request"); // honeypot
    if (!(await hasDisplayName(proposer))) {
      throw new HttpError(403, "Set a display name (or an ENS primary name) before submitting.");
    }
    if (!(await db.rateLimit("submit:" + c.var.ip, SUBMISSIONS_PER_HOUR_PER_IP, 3600))) {
      throw new HttpError(
        429,
        "Too many submissions from your address; try again in an hour.",
      );
    }
    let discourseUrl = "";
    if (s(body.discourseUrl)) {
      const [clean, err] = await validateForumUrl(body.discourseUrl, deps.resolve);
      if (err) throw new HttpError(400, err);
      discourseUrl = clean!;
    }
    // The title may be left blank when a forum link is given: we read the
    // topic's title from Discourse (SSRF-hardened, best effort).
    let title = s(body.title);
    if (!title && discourseUrl) {
      title = (await fetchDiscourseTitle(discourseUrl, deps.fetch, deps.resolve)) ?? "";
    }
    if (title.length < 8) {
      throw new HttpError(
        400,
        discourseUrl && !s(body.title)
          ? "We could not read a title from that forum link. Please give the initiative a title (at least 8 characters)."
          : "Please give the initiative a title (at least 8 characters), or a forum link we can read it from.",
      );
    }
    if (s(body.summary).length < 40) {
      throw new HttpError(
        400,
        "Please describe the initiative in at least 40 characters.",
      );
    }
    const text = validateText({
      title,
      summary: s(body.summary),
      details: s(body.details, 100_000),
    });
    const [goal, gerr] = parseGoal(body.goal);
    if (gerr) throw new HttpError(400, gerr);
    // NEVER rendered publicly: private fundraising leads, admin-only like contact.
    const funders = s(body.funders, MAX_FUNDERS);
    if (funders.length < 10) {
      throw new HttpError(
        400,
        "Please list who is likely to fund this (at least one funder line).",
      );
    }
    const type = body.type === "grant" ? "grant" : "rfp";
    const rfp = await db.rfps.insert({
      ...text,
      discourseUrl,
      goalUsd: goal!,
      contact: s(body.contact, 200),
      type,
      funders,
      proposer,
      status: "pending",
    });
    return c.json({ slug: rfp.slug, status: rfp.status }, 201);
  });

  return r;
}
