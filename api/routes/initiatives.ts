import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireClientIp } from "../middleware/ip.ts";
import { assertInitiativeIdentity } from "../lib/initiative-identity.ts";
import { jsonBody, s } from "../lib/body.ts";
import { assertRecentAuth, requireAuth } from "../middleware/auth.ts";
import { canReadPrivateFields } from "../lib/private-fields.ts";
import {
  adminInitiative,
  donationJson,
  pledgeJson,
  publicInitiative,
  revisionJson,
  revisionMeta,
} from "../lib/json.ts";
import { cleanText, validateForumUrl } from "../lib/validate.ts";
import { pctOf } from "./board.ts";
import {
  MAX_FUNDERS,
  REVISIONS_PER_HOUR_PER_ADDRESS,
  SUBMISSIONS_PER_HOUR_PER_IP,
  TOKENS,
} from "../config.ts";
import type { Initiative, Pledge, Revision, Session } from "../db/types.ts";
import { isLive } from "../db/revisions.ts";
import { pickText } from "../db/initiatives.ts";
import { ledgerStatus, refreshLedger } from "../services/ledger.ts";
import { chainStateFresh, tokensUsable } from "../chain/mod.ts";
import {
  assertNoErrors,
  mergeFindings,
  readBackers,
  readStructured,
  TEXT_FIELDS,
} from "../lib/structured.ts";
import { PAGE_FACT_FIELDS, readPageFacts } from "../lib/page-facts.ts";
import { readCategories } from "../../shared/categories.ts";
import { ownsUpload } from "./uploads.ts";
import {
  bodyKey,
  type CheckBacker,
  checkSubmission,
  type Finding,
  isStructured,
  LIMITS,
  parseAmount,
} from "../../shared/draft/mod.ts";

export const decimalsOf = (sym: string): number | undefined => TOKENS[sym]?.[1];

/** Stored pledges as the backers the rules read (withdrawn ones do not count). */
export const pledgeBackers = (pledges: Pledge[]): CheckBacker[] =>
  pledges.filter((p) => p.status !== "withdrawn" && p.company)
    .map((p) => ({ org: p.company, amountUsd: p.amountUsd, url: p.url }));

/** The text rules of an edit: title, summary, sections, milestones against
 * the stored goal, links. Page facts and backers are checked where they are
 * edited; the stored pledges still count as backers here, since a top-up's
 * adoption floor is measured against what this grant raises. */
export function editChecks(initiative: Pick<Initiative, "type" | "topup" | "goalUsd">, text: {
  title: string;
  summary: string;
  sections: Initiative["sections"];
  milestones: Initiative["milestones"];
  links: Initiative["links"];
}, backers: CheckBacker[]) {
  return checkSubmission({
    type: initiative.type,
    topup: Boolean(initiative.topup),
    page: {
      title: text.title,
      summary: text.summary,
      goal: initiative.goalUsd,
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

  const isProposer = (initiative: Initiative, user: Session | null) =>
    Boolean(
      user && initiative.proposer &&
        initiative.proposer.toLowerCase() === user.address.toLowerCase(),
    );

  /**
   * Published rows for everyone; a pending or rejected one for its proposer and
   * admins (pending so it can be edited, rejected so it can be read again).
   */
  const visibleOr404 = async (
    slug: string,
    user: Session | null,
    mutation?: Record<string, unknown>,
  ): Promise<Initiative> => {
    const initiative = await db.initiatives.bySlug(slug);
    if (initiative && mutation) {
      await assertInitiativeIdentity(db, slug, initiative, mutation.initiativeId);
    }
    const ok = initiative && (
      ["approved", "archived"].includes(initiative.status) ||
      (["pending", "rejected"].includes(initiative.status) &&
        (user?.isAdmin || isProposer(initiative, user)))
    );
    if (!ok) throw new HttpError(404, "not found");
    return initiative;
  };

  /** The proposer (or an admin) may act on this row; everyone else is refused. */
  /** Throws unless `user` may edit the row: its proposer, or an admin. */
  const assertEditor = (initiative: Initiative, user: Session) => {
    if (!isProposer(initiative, user) && !user.isAdmin) {
      throw new HttpError(403, "Only the proposer can edit this initiative.");
    }
  };
  const editableBy = async (slug: string, user: Session, body: Record<string, unknown>) => {
    const initiative = await visibleOr404(slug, user, body);
    assertEditor(initiative, user);
    return { initiative, proposer: isProposer(initiative, user) };
  };

  /** The admin's note when the proposer's latest edit was turned down and
   * nothing was saved since; null otherwise. */
  const lastRejection = async (x: Initiative) => {
    if (x.pendingRevision || !x.lastRevision || x.lastRevision <= x.revision) return null;
    const last = await db.revisions.get(x.id, x.lastRevision);
    return last?.state === "rejected"
      ? { n: last.n, note: last.note ?? "", at: last.reviewedAt ?? last.createdAt }
      : null;
  };

  /** What the signed-in wallet proposed, any status, newest first. Before "/:slug". */
  r.get("/mine", requireAuth, async (c) => {
    const user = c.var.user!;
    const rows = await db.initiatives.list(["pending", "approved", "rejected", "archived"]);
    const initiatives = await Promise.all(
      rows
        .filter((x) => isProposer(x, user))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (x) => ({
          slug: x.slug,
          title: x.title,
          type: x.type,
          status: x.status,
          goalUsd: x.goalUsd,
          createdAt: x.createdAt,
          editInReview: Boolean(x.pendingRevision),
          editRejected: await lastRejection(x),
        })),
    );
    return c.json({ initiatives });
  });

  r.get("/:slug", async (c) => {
    const user = c.var.user;
    const initiative = await visibleOr404(c.req.param("slug"), user);
    const asked = c.req.query("refresh") === "1";
    const paused = asked && await deps.maintenance.on();
    const refresh = asked && !paused;
    if (refresh) await refreshLedger(deps, initiative);
    const [pledges, donations, chainState, revisions, ledger] = await Promise.all([
      db.pledges.list(initiative.id),
      db.donations.list(initiative.id),
      deps.chain.state(refresh),
      db.revisions.list(initiative.id, Boolean(user?.isAdmin)),
      ledgerStatus(deps, initiative),
    ]);
    const summary = await deps.funding.summaryFrom(initiative, pledges, donations, refresh);
    if (paused) summary.refreshDue = false;
    const privateFields = canReadPrivateFields(initiative, user, deps.now());
    return c.json({
      refreshDue: !paused && !chainStateFresh(chainState, deps.now()),
      initiative: user?.isAdmin || privateFields
        ? adminInitiative(initiative, privateFields)
        : publicInitiative(initiative),
      revisions: revisions.map(revisionMeta),
      summary,
      pct: pctOf(summary.total, initiative.goalUsd),
      pledges: pledges.map((p) => pledgeJson(config, p)),
      donations: donations.map((d) => donationJson(d, decimalsOf)),
      funded: Boolean(initiative.goalUsd && summary.total >= initiative.goalUsd),
      donationsEnabled: Boolean(
        tokensUsable(chainState) && initiative.safeAddress && initiative.status === "approved",
      ),
      ledger: paused && ledger ? { ...ledger, refreshDue: false } : ledger,
    });
  });

  /** One version of the text as it was published; archived ones are for
   * admins only, and an edit that is held or was never published (rejected,
   * superseded) is for its proposer and the admins. */
  r.get("/:slug/revisions/:n", async (c) => {
    const user = c.var.user;
    const initiative = await visibleOr404(c.req.param("slug"), user);
    const n = Number(c.req.param("n"));
    const rev = Number.isInteger(n) && n > 0 ? await db.revisions.get(initiative.id, n) : null;
    const mine = Boolean(user?.isAdmin) || isProposer(initiative, user);
    if (!rev || (rev.archived && !user?.isAdmin) || (!isLive(rev) && !mine)) {
      throw new HttpError(404, "not found");
    }
    return c.json({ revision: revisionJson(rev) });
  });

  /**
   * The proposer (or an admin) replaces the text, the categories or both: the
   * only way either changes. Goes live at once, with the previous version
   * kept in the history, except a proposer's edit to an approved initiative:
   * approval is a review of the text, so that edit is held (`pending: true`)
   * and the approved version stays live until an admin accepts it. Text edits
   * use structured sections, milestones and links, migrating legacy rows when
   * necessary; a body with only `categories` keeps the text as it is.
   */
  r.post("/:slug/revisions", requireAuth, async (c) => {
    const user = c.var.user!;
    const body = await jsonBody(c, ["initiativeId", ...TEXT_FIELDS, "categories"]);
    const { initiative, proposer } = await editableBy(c.req.param("slug"), user, body);
    const tagsOnly = body.categories !== undefined &&
      TEXT_FIELDS.every((k) => body[k] === undefined);
    // The team may still retag a closed row: unarchiving needs a category.
    const assertOpen = (row: Initiative) => {
      const open = row.status === "pending" || row.status === "approved" ||
        (tagsOnly && user.isAdmin);
      if (!open) throw new HttpError(403, "This initiative is no longer open for edits.");
    };
    assertOpen(initiative);
    // The hourly cap is for proposers; the team edits without one.
    if (
      !user.isAdmin &&
      !(await db.rateLimit(
        "revise:" + user.address.toLowerCase(),
        REVISIONS_PER_HOUR_PER_ADDRESS,
        3600,
      ))
    ) {
      throw new HttpError(429, "Too many edits; try again in an hour.");
    }
    const origin = { author: user.address, source: proposer ? "proposer" : "admin" } as const;
    // Asked again inside the write, on the row it commits against: a change
    // racing this request can neither publish an unreviewed edit to an
    // approved initiative, nor reopen a closed one, nor let a wallet that is
    // no longer the proposer write.
    const holdWhen = (row: Initiative) => {
      assertEditor(row, user);
      assertOpen(row);
      return !user.isAdmin && row.status === "approved";
    };
    const saved = (next: Initiative, revision: Revision, warnings: Finding[]) => {
      const held = !isLive(revision);
      return c.json({
        initiative: held
          ? adminInitiative(next, canReadPrivateFields(next, user, deps.now()))
          : publicInitiative(next),
        revision: revisionMeta(revision),
        warnings,
        ...(held ? { pending: true } : {}),
      }, 201);
    };
    const [categories, categoryErr] = body.categories === undefined
      ? [undefined, null]
      : readCategories(body.categories);
    const tags = {
      errors: categoryErr
        ? [{ field: "categories", msg: categoryErr, kind: "content" } satisfies Finding]
        : [],
      warnings: [],
    };
    if (tagsOnly) {
      assertNoErrors(tags);
      const { initiative: next, revision } = await db.initiatives.retag(
        initiative.id,
        categories!,
        origin,
        holdWhen,
      );
      if (!revision) throw new HttpError(400, "Nothing changed.");
      return saved(next, revision, []);
    }
    const cur = pickText(initiative);
    const structuredBody = ["sections", "milestones", "links"].some((k) => body[k] !== undefined);
    if (!structuredBody) {
      throw new HttpError(
        400,
        "Send sections, milestones and links to edit initiative text.",
      );
    }
    // The text rules (length floors and caps included) come back as
    // findings painted on the fields, the same as on submit.
    const base = {
      title: cleanText(body.title, "title"),
      summary: cleanText(body.summary, "summary"),
      details: "",
    };
    const { structured, findings: caps } = readStructured({
      sections: body.sections ?? cur.sections,
      milestones: body.milestones ?? cur.milestones,
      links: body.links ?? cur.links,
    }, initiative.type);
    const backers = pledgeBackers(await db.pledges.list(initiative.id));
    const findings = mergeFindings(
      caps,
      editChecks(initiative, { ...base, ...structured }, backers),
      tags,
    );
    assertNoErrors(findings);
    const { warnings } = findings;
    const { initiative: next, revision } = await db.initiatives.revise(
      initiative.id,
      { ...base, ...structured, categories: categories ?? undefined },
      origin,
      holdWhen,
    );
    if (!revision) throw new HttpError(400, "Nothing changed.");
    return saved(next, revision, warnings);
  });

  /**
   * The page facts (type, top-up, goal, duration, recipient, reviewer, forum
   * link, funders, contact): the proposer may change them while the row is
   * pending; after approval they belong to the team. Admins always may.
   */
  r.patch("/:slug", requireAuth, async (c) => {
    const user = c.var.user!;
    const body = await jsonBody(c, ["initiativeId", ...PAGE_FACT_FIELDS]);
    const { initiative } = await editableBy(c.req.param("slug"), user, body);
    // Checked here for the answer, and again inside the write on the row it
    // commits against: an approval or a new proposer landing mid-request locks it.
    const assertUnlocked = (row: Initiative) => {
      assertEditor(row, user);
      if (
        user.isAdmin && !isProposer(row, user) &&
        (body.contact !== undefined || body.funders !== undefined)
      ) assertRecentAuth(c, deps.now);
      if (!user.isAdmin && row.status !== "pending") {
        throw new HttpError(403, "Locked after approval; email the team.");
      }
    };
    assertUnlocked(initiative);
    const patch = await readPageFacts(body, initiative, deps);
    const next = Object.keys(patch).length
      ? await db.initiatives.update(initiative.id, patch, assertUnlocked)
      : initiative;
    return c.json({
      initiative: adminInitiative(next, canReadPrivateFields(next, user, deps.now())),
    });
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
    const body = await jsonBody(c, [
      ...TEXT_FIELDS,
      ...PAGE_FACT_FIELDS,
      "categories",
      "backers",
      "website",
    ]);
    if (s(body.website)) throw new HttpError(400, "bad request"); // honeypot
    if (!(await hasDisplayName(proposer))) {
      throw new HttpError(403, "Set a display name (or an ENS primary name) before submitting.");
    }
    if (!(await db.rateLimit("submit:" + requireClientIp(c), SUBMISSIONS_PER_HOUR_PER_IP, 3600))) {
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
    // Discussion links are stored as links, never fetched by the server.
    // Requiring an explicit title also removes the DNS-rebinding window
    // that a separate hostname check followed by fetch would leave open.
    const title = cleanText(body.title, "title");
    if (title.length < 8) {
      throw new HttpError(400, "Please give the initiative a title (at least 8 characters).");
    }
    const summary = cleanText(body.summary, "summary");
    const type = body.type === "grant" ? "grant" : "rfp";
    const topup = type === "grant" && Boolean(body.topup);
    const { structured, findings: caps } = readStructured(body, type);
    const { backers, findings: backerCaps } = readBackers(body);
    // Page facts. Amounts are read the forgiving way ("150,000", "150.000");
    // a leading minus survives so the range rule can refuse it.
    const rawGoal = String(body.goal ?? "");
    const goal = Math.round((/^\s*-/.test(rawGoal) ? -1 : 1) * parseAmount(rawGoal) * 100) / 100;
    const duration = s(body.durationMonths, 10);
    // One character past each cap survives so checkSubmission reports "too long".
    const recipientTeam = type === "grant" ? s(body.recipientTeam, LIMITS.RECIPIENT_CHARS + 1) : "";
    const recipientUrl = type === "grant" ? s(body.recipientUrl, LIMITS.LINK_CHARS + 1) : "";
    const milestoneReviewer = topup ? s(body.milestoneReviewer, LIMITS.REVIEWER_CHARS + 1) : "";
    // NEVER rendered publicly: private fundraising leads, admin-only like contact.
    const funders = s(body.funders, MAX_FUNDERS + 1);
    const contact = s(body.contact, LIMITS.CONTACT_CHARS + 1);
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
        reviewer: milestoneReviewer,
      },
      ...structured,
      backers,
    }, "submit");
    const extra: Finding[] = [];
    const [categories, categoryErr] = readCategories(body.categories ?? []);
    if (categoryErr) extra.push({ field: "categories", msg: categoryErr, kind: "content" });
    // Logo receipts: a CID rides the form only if this wallet pinned it.
    for (const [i, b] of backers.entries()) {
      if (b.logoCid && !(await ownsUpload(db, b.logoCid, proposer))) {
        extra.push({ field: `bk_logo_${i}`, msg: "Upload the logo again.", kind: "content" });
      }
    }
    // Archived proposals may be resubmitted; other statuses still block copies.
    if (isStructured(structured)) {
      const key = bodyKey(structured.sections, structured.milestones);
      const all = await db.initiatives.list(["pending", "approved", "rejected"]);
      const dup = all.find((x) => {
        const t = pickText(x);
        return isStructured(t) && bodyKey(t.sections, t.milestones) === key;
      });
      if (dup) {
        extra.push({
          field: "",
          msg:
            `The section text and milestone names and criteria match an existing submission ("${dup.title}"). Revise that content before submitting again; changing only the title does not make it a new submission.`,
          kind: "content",
        });
      }
    }
    const findings = mergeFindings(caps, backerCaps, checks, { errors: extra, warnings: [] });
    assertNoErrors(findings);
    const initiative = await db.initiatives.insert(
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
        categories: categories!,
      },
      undefined,
      undefined,
      { reclaimArchivedSlug: true },
    );
    for (const b of backers) {
      if (!b.org) continue;
      await db.pledges.add(initiative.id, {
        company: b.org,
        amountUsd: b.amountUsd,
        status: "pledged",
        note: "",
        url: b.url,
        logoCid: b.logoCid,
      });
    }
    return c.json(
      { slug: initiative.slug, status: initiative.status, warnings: findings.warnings },
      201,
    );
  });

  return r;
}
