import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { assertInitiativeIdentity } from "../lib/initiative-identity.ts";
import { jsonBody, s } from "../lib/body.ts";
import { requireAuth } from "../middleware/auth.ts";
import {
  donationJson,
  pledgeJson,
  proposerRfp,
  publicRfp,
  revisionJson,
  revisionMeta,
} from "../lib/json.ts";
import { cleanText, validateForumUrl, validateText } from "../lib/validate.ts";
import { pctOf } from "./board.ts";
import { onrampLink } from "../lib/onramp.ts";
import { fetchDiscourseTitle } from "../services/forum.ts";
import {
  MAX_FUNDERS,
  REVISIONS_PER_HOUR_PER_ADDRESS,
  SUBMISSIONS_PER_HOUR_PER_IP,
  TOKENS,
} from "../config.ts";
import type { Pledge, Rfp, Session } from "../db/types.ts";
import { pickText } from "../db/rfps.ts";
import { cronIntervalMinutes } from "../services/funding.ts";
import { assertNoErrors, mergeFindings, readBackers, readStructured } from "../lib/structured.ts";
import { readPageFacts } from "../lib/page-facts.ts";
import { ownsUpload } from "./uploads.ts";
import {
  bodyKey,
  type CheckBacker,
  checkSubmission,
  type Finding,
  isStructured,
  parseAmount,
} from "../../shared/draft/mod.ts";

export { onrampLink };
export const decimalsOf = (sym: string): number | undefined => TOKENS[sym]?.[1];

/** Stored pledges as the backers the rules read (withdrawn ones do not count). */
export const pledgeBackers = (pledges: Pledge[]): CheckBacker[] =>
  pledges.filter((p) => p.status !== "withdrawn" && p.company)
    .map((p) => ({ org: p.company, amountUsd: p.amountUsd, url: p.url }));

/** The text rules of an edit: title, summary, sections, milestones against
 * the stored goal, links. Page facts and backers are checked where they are
 * edited; the stored pledges still count as backers here, since a top-up's
 * adoption floor is measured against what this grant raises. */
export function editChecks(rfp: Pick<Rfp, "type" | "topup" | "goalUsd">, text: {
  title: string;
  summary: string;
  sections: Rfp["sections"];
  milestones: Rfp["milestones"];
  links: Rfp["links"];
}, backers: CheckBacker[]) {
  return checkSubmission({
    type: rfp.type,
    topup: Boolean(rfp.topup),
    page: {
      title: text.title,
      summary: text.summary,
      goal: rfp.goalUsd,
      duration: "",
      recipient: "",
      funders: "",
      contact: "",
    },
    sections: text.sections,
    milestones: text.milestones,
    links: text.links,
    backers,
  }, "edit");
}

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
  const visibleOr404 = async (
    slug: string,
    user: Session | null,
    mutation?: Record<string, unknown>,
  ): Promise<Rfp> => {
    const rfp = await db.rfps.bySlug(slug);
    if (rfp && mutation) await assertInitiativeIdentity(db, slug, rfp, mutation.initiativeId);
    const ok = rfp && (
      ["approved", "archived"].includes(rfp.status) ||
      (rfp.status === "pending" && (user?.isAdmin || isProposer(rfp, user)))
    );
    if (!ok) throw new HttpError(404, "not found");
    return rfp;
  };

  /** The proposer (or an admin) may act on this row; everyone else is refused. */
  const editableBy = async (slug: string, user: Session, body: Record<string, unknown>) => {
    const rfp = await visibleOr404(slug, user, body);
    const proposer = isProposer(rfp, user);
    if (!proposer && !user.isAdmin) {
      throw new HttpError(403, "Only the proposer can edit this initiative.");
    }
    return { rfp, proposer };
  };

  r.get("/:slug", async (c) => {
    const user = c.var.user;
    const rfp = await visibleOr404(c.req.param("slug"), user);
    const [summary, pledges, donations, active, revisions, sync] = await Promise.all([
      deps.funding.summary(rfp),
      db.pledges.list(rfp.id),
      db.donations.list(rfp.id),
      deps.chain.activeTokens(),
      db.revisions.list(rfp.id, Boolean(user?.isAdmin)),
      rfp.safeAddress ? db.meta.safeSync(rfp.id) : Promise.resolve(null),
    ]);
    const mine = Boolean(user?.isAdmin) || isProposer(rfp, user);
    return c.json({
      initiative: mine ? proposerRfp(rfp) : publicRfp(rfp),
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
      // Where the donations table stands: the ledger is filled by the Safe
      // cron, so the page says when it last ran and how often it does.
      ledger: rfp.safeAddress
        ? {
          checkedAt: sync?.at ?? null,
          ok: sync?.ok ?? true,
          intervalMinutes: cronIntervalMinutes(config.safeSyncCron),
        }
        : null,
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
   * The proposer (or an admin) replaces the text. Goes live at once; the
   * previous text stays in the history. A body with `sections`, `milestones`
   * or `links` takes the structured path (the rules of the form, "edit"
   * scope, block); a legacy `details` body is accepted on legacy rows only.
   */
  r.post("/:slug/revisions", requireAuth, async (c) => {
    const user = c.var.user!;
    const body = await jsonBody(c);
    const { rfp, proposer } = await editableBy(c.req.param("slug"), user, body);
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
    const cur = pickText(rfp);
    const structuredBody = ["sections", "milestones", "links"].some((k) => body[k] !== undefined);
    if (!structuredBody && isStructured(cur)) {
      throw new HttpError(
        400,
        "This initiative uses sections; send sections, milestones and links.",
      );
    }
    const origin = { author: user.address, source: proposer ? "proposer" : "admin" } as const;
    let warnings: Finding[] = [];
    let text;
    if (structuredBody) {
      const base = validateText({ title: s(body.title), summary: s(body.summary), details: "" });
      const { structured, findings: caps } = readStructured({
        sections: body.sections ?? cur.sections,
        milestones: body.milestones ?? cur.milestones,
        links: body.links ?? cur.links,
      }, rfp.type);
      const backers = pledgeBackers(await db.pledges.list(rfp.id));
      const findings = mergeFindings(caps, editChecks(rfp, { ...base, ...structured }, backers));
      assertNoErrors(findings);
      warnings = findings.warnings;
      text = { ...base, ...structured };
    } else {
      text = validateText({
        title: s(body.title),
        summary: s(body.summary),
        details: s(body.details, 100_000),
      });
    }
    const { rfp: next, revision } = await db.rfps.revise(rfp.id, text, origin);
    if (!revision) throw new HttpError(400, "Nothing changed.");
    return c.json(
      { initiative: publicRfp(next), revision: revisionMeta(revision), warnings },
      201,
    );
  });

  /**
   * The page facts (type, top-up, goal, duration, recipient, reviewer, forum
   * link, funders, contact): the proposer may change them while the row is
   * pending; after approval they belong to the team. Admins always may.
   */
  r.patch("/:slug", requireAuth, async (c) => {
    const user = c.var.user!;
    const body = await jsonBody(c);
    const { rfp } = await editableBy(c.req.param("slug"), user, body);
    if (!user.isAdmin && rfp.status !== "pending") {
      throw new HttpError(403, "Locked after approval; email the team.");
    }
    const patch = await readPageFacts(body, rfp, deps);
    const next = Object.keys(patch).length ? await db.rfps.update(rfp.id, patch) : rfp;
    return c.json({ initiative: proposerRfp(next) });
  });

  /**
   * Submission from a signed-in wallet that has a display name (ENS primary
   * name or site nickname); always lands as pending for admin review. The
   * body is the form: page fields, one answer per section, milestone rows,
   * links, backers. Every rule the form runs is run again here and the
   * failures come back as `findings` painted on the fields.
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
    let title = cleanText(body.title, "title");
    if (!title && discourseUrl) {
      title = cleanText(
        await fetchDiscourseTitle(discourseUrl, deps.fetch, deps.resolve),
        "title",
      );
    }
    if (title.length < 8) {
      throw new HttpError(
        400,
        discourseUrl && !s(body.title)
          ? "We could not read a title from that discussion link. Please give the initiative a title (at least 8 characters)."
          : "Please give the initiative a title (at least 8 characters), or a Discourse link we can read it from.",
      );
    }
    const summary = cleanText(body.summary, "summary");
    const type = body.type === "grant" ? "grant" : "rfp";
    const topup = type === "grant" && Boolean(body.topup);
    const { structured, findings: caps } = readStructured(body, type);
    const { backers, findings: backerCaps } = readBackers(body);
    // Page facts. Amounts are read the forgiving way ("150,000", "150.000");
    // a leading minus survives so the range rule can refuse it.
    const rawGoal = String(body.goal ?? body.goalUsd ?? "");
    const goal = Math.round((/^\s*-/.test(rawGoal) ? -1 : 1) * parseAmount(rawGoal) * 100) / 100;
    const duration = s(body.durationMonths ?? body.duration, 10);
    const recipientTeam = type === "grant" ? s(body.recipientTeam, 120) : "";
    const recipientUrl = type === "grant" ? s(body.recipientUrl, 300) : "";
    const milestoneReviewer = topup ? s(body.milestoneReviewer, 200) : "";
    // NEVER rendered publicly: private fundraising leads, admin-only like contact.
    const funders = s(body.funders, MAX_FUNDERS);
    const contact = s(body.contact, 200);
    const checks = checkSubmission({
      type,
      topup,
      page: {
        title,
        summary,
        goal,
        duration,
        recipient: recipientTeam,
        recipientUrl,
        funders,
        contact,
      },
      ...structured,
      backers,
    }, "submit");
    const extra: Finding[] = [];
    // Logo receipts: a CID rides the form only if this wallet pinned it.
    for (const [i, b] of backers.entries()) {
      if (b.logoCid && !(await ownsUpload(db, b.logoCid, proposer))) {
        extra.push({ field: `bk_logo_${i}`, msg: "Upload the logo again.", kind: "content" });
      }
    }
    // Archived proposals may be resubmitted; other statuses still block copies.
    if (isStructured(structured)) {
      const key = bodyKey(structured.sections, structured.milestones);
      const all = await db.rfps.list(["pending", "approved", "rejected"]);
      const dup = all.find((x) => {
        const t = pickText(x);
        return isStructured(t) && bodyKey(t.sections, t.milestones) === key;
      });
      if (dup) {
        extra.push({
          field: "",
          msg:
            `This exact text is already submitted ("${dup.title}"). Edit it before submitting again.`,
          kind: "content",
        });
      }
    }
    const findings = mergeFindings(caps, backerCaps, checks, { errors: extra, warnings: [] });
    assertNoErrors(findings);
    const rfp = await db.rfps.insert(
      {
        title,
        summary,
        details: "",
        ...structured,
        discourseUrl,
        goalUsd: goal,
        contact,
        type,
        funders,
        proposer,
        status: "pending",
        durationMonths: /^\d+$/.test(duration) ? Number(duration) : null,
        recipientTeam,
        recipientUrl,
        topup,
        milestoneReviewer,
      },
      undefined,
      undefined,
      { reclaimArchivedSlug: true },
    );
    for (const b of backers) {
      if (!b.org) continue;
      await db.pledges.add(rfp.id, {
        company: b.org,
        amountUsd: b.amountUsd,
        status: "pledged",
        note: "",
        url: b.url,
        logoCid: b.logoCid,
      });
    }
    return c.json({ slug: rfp.slug, status: rfp.status, warnings: findings.warnings }, 201);
  });

  return r;
}
