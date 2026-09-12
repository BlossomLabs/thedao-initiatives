import { type Context, Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { requireAdmin } from "../middleware/auth.ts";
import {
  adminCommentJson,
  adminRfp,
  donationJson,
  ipfsUrl,
  pledgeJson,
  revisionMeta,
} from "../lib/json.ts";
import { DOMAIN_RE, parseGoal, TX_HASH_RE, validateText } from "../lib/validate.ts";
import { decimalsOf, editChecks } from "./initiatives.ts";
import { readPageFacts } from "../lib/page-facts.ts";
import { assertNoErrors, mergeFindings, readStructured } from "../lib/structured.ts";
import { pickText, type RfpText } from "../db/rfps.ts";
import { type Findings, isStructured } from "../../shared/draft/mod.ts";
import { safeDeployCalldata, signersConfigured } from "../chain/safe.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import { LOGO_NAME_RE, syncContent } from "../services/content.ts";
import { syncSafe } from "../services/safe-api.ts";
import { liveRoles } from "../services/roles.ts";
import type { AdminEntry } from "../services/admins.ts";
import type { Comment, Pledge, PledgeStatus, Rfp } from "../db/types.ts";
import { CHAIN_ID, LOGO_MAX_BYTES, SAFE_PROXY_FACTORY, SAFE_THRESHOLD } from "../config.ts";

const TEXT_KEYS = ["title", "summary", "details", "sections", "milestones", "links"];
/** Findings that block an admin save: shape rules, not editorial ones. */
const HARD_FIELD_RE = /^(links(_\d+)?|ms_\d+_(link|month))$/;

export function adminRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config, chain, ens } = deps;
  r.use("*", requireAdmin);

  /** Admin routes address an initiative by slug (the URL) or by id (older links). */
  const rfpOr404 = async (idOrSlug: string): Promise<Rfp> => {
    const rfp = (await db.rfps.bySlug(idOrSlug)) ?? (await db.rfps.get(idOrSlug));
    if (!rfp) throw new HttpError(404, "not found");
    return rfp;
  };
  const withInitiative = async (rows: Comment[]) => {
    const out = [];
    const admins = await deps.admins.set();
    for (const cm of rows) {
      const rfp = await db.rfps.get(cm.rfpId);
      out.push(adminCommentJson(cm, liveRoles(admins, cm.address, rfp), rfp));
    }
    return out;
  };

  r.get("/dashboard", async (c) => {
    const [pending, approved, other] = await Promise.all([
      db.rfps.list(["pending"]),
      db.rfps.list(["approved"]),
      db.rfps.list(["rejected", "archived"]),
    ]);
    const rows = [];
    for (const rfp of [...pending, ...approved, ...other]) {
      rows.push({
        initiative: adminRfp(rfp),
        summary: await deps.funding.summary(rfp),
        safeSync: rfp.safeAddress ? await db.meta.safeSync(rfp.id) : null,
      });
    }
    const held = await db.comments.held();
    const unanswered = await db.comments.unansweredQuestions();
    const weekAgo = deps.now() - 7 * 86400;
    const stale = unanswered.filter((q) => q.createdAt < weekAgo);
    const [signersOk, signersDetail] = signersConfigured(config.operationalSigners);
    return c.json({
      rows,
      pendingCount: pending.length,
      chain: await chain.state(),
      held: await withInitiative(held),
      unanswered: await withInitiative(unanswered),
      reported: await withInitiative(await db.comments.reported()),
      weekAgo,
      bell: held.length + stale.length,
      safeApi: {
        configured: Boolean(config.safeApiKey),
        quota: await db.meta.get("safe_api_quota"),
        cron: config.safeSyncCron,
      },
      signers: {
        ok: signersOk,
        detail: signersDetail,
        list: config.operationalSigners,
        threshold: SAFE_THRESHOLD,
      },
    });
  });

  // The admin list. ADMIN_ADDRESSES entries are fixed; the rest live in KV.
  const adminsJson = (admins: AdminEntry[], c: Context<Vars>) =>
    c.json({ admins, you: c.var.user!.address });
  r.get("/admins", async (c) => adminsJson(await deps.admins.list(), c));
  r.post("/admins", async (c) => {
    const body = await jsonBody(c);
    return adminsJson(await deps.admins.add(s(body.address, 60)), c);
  });
  r.delete("/admins/:address", async (c) => {
    return adminsJson(await deps.admins.remove(c.req.param("address"), c.var.user!.address), c);
  });

  r.get("/initiatives/:id", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const [signersOk, signersDetail] = signersConfigured(config.operationalSigners);
    return c.json({
      initiative: adminRfp(rfp),
      revisions: (await db.revisions.list(rfp.id, true)).map(revisionMeta),
      summary: await deps.funding.summary(rfp),
      pledges: (await db.pledges.list(rfp.id, true)).map((p) => pledgeJson(config, p)),
      donations: (await db.donations.list(rfp.id, false)).map((d) => donationJson(d, decimalsOf)),
      safeSync: rfp.safeAddress ? await db.meta.safeSync(rfp.id) : null,
      signers: {
        ok: signersOk,
        detail: signersDetail,
        list: config.operationalSigners,
        threshold: SAFE_THRESHOLD,
      },
    });
  });

  /**
   * The admin editor. Page facts go through `readPageFacts`; the text
   * (title, summary, and the structured body or the legacy details) is
   * revisioned together, fields not sent carrying over from the row. Shape
   * rules block (caps, https links, month format, byte cap, structured XOR
   * details); the editorial rules (required sections, sums, adoption) come
   * back as `findings` for the form to show without blocking.
   */
  r.patch("/initiatives/:id", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const body = await jsonBody(c);
    const patch = await readPageFacts(body, rfp, deps);
    if (body.sortRank !== undefined) {
      const raw = s(body.sortRank, 10);
      if (!raw) patch.sortRank = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n)) {
          throw new HttpError(400, "Pin position must be a number (1-999).");
        }
        patch.sortRank = Math.max(1, Math.min(999, n));
      }
    }
    // Money already paid to the team, so "raised" (balance + paid out) never goes backwards.
    if (body.paidOutUsd !== undefined) {
      const raw = s(body.paidOutUsd, 20).replace(/[,$\s]/g, "");
      const n = raw ? Number(raw) : 0;
      if (!Number.isFinite(n) || n < 0) {
        throw new HttpError(400, "Paid out must be a USD amount of zero or more.");
      }
      patch.paidOutUsd = Math.round(n * 100) / 100;
    }
    // Owner: the wallet shown publicly as "Proposed by". Address or ENS name; blank clears.
    if (body.proposer !== undefined) {
      const raw = s(body.proposer, 100);
      const lower = raw.toLowerCase();
      if (!raw) patch.proposer = "";
      else if (isAddress(raw)) patch.proposer = toChecksum(raw);
      else if (DOMAIN_RE.test(lower)) {
        const resolved = await ens.forward(raw);
        if (!resolved) throw new HttpError(400, `${raw} does not resolve to an address.`);
        patch.proposer = resolved;
      } else throw new HttpError(400, "Owner must be a wallet address or an ENS name.");
    }
    const nextType = patch.type ?? rfp.type;
    const cur = pickText(rfp);
    const textGiven = TEXT_KEYS.some((k) => body[k] !== undefined);
    // A type switch re-normalises a structured body: other-type sections go.
    const reshape = nextType !== rfp.type && isStructured(cur);
    let text: RfpText | null = null;
    let findings: Findings = { errors: [], warnings: [] };
    if (textGiven || reshape) {
      const base = textGiven
        ? validateText({
          title: body.title === undefined ? cur.title : s(body.title),
          summary: body.summary === undefined ? cur.summary : s(body.summary),
          details: body.details === undefined ? cur.details : s(body.details, 100_000),
        })
        : { title: cur.title, summary: cur.summary, details: cur.details };
      const { structured, findings: caps } = readStructured({
        sections: body.sections === undefined ? cur.sections : body.sections,
        milestones: body.milestones === undefined ? cur.milestones : body.milestones,
        links: body.links === undefined ? cur.links : body.links,
      }, nextType);
      if (isStructured(structured)) {
        // Sending sections to a legacy row migrates it; sending both is a mistake.
        if (body.details === undefined) base.details = "";
        if (base.details) throw new HttpError(400, "Send either details or sections, not both.");
        const checks = editChecks(
          {
            type: nextType,
            topup: patch.topup ?? rfp.topup,
            goalUsd: patch.goalUsd ?? rfp.goalUsd,
          },
          { ...base, ...structured },
        );
        const hard = checks.errors.filter((e) => HARD_FIELD_RE.test(e.field));
        assertNoErrors(mergeFindings(caps, { errors: hard, warnings: [] }));
        findings = mergeFindings(caps, checks);
      } else assertNoErrors(caps);
      text = { ...base, ...structured };
    }
    let next = Object.keys(patch).length ? await db.rfps.update(rfp.id, patch) : rfp;
    if (text) {
      next = (await db.rfps.revise(rfp.id, text, {
        author: c.var.user!.address,
        source: "admin",
      })).rfp;
    }
    return c.json({ initiative: adminRfp(next), findings });
  });

  /** Hide a superseded revision from the public history, or show it again. */
  r.post("/initiatives/:id/revisions/:n", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const n = Number(c.req.param("n"));
    const action = s((await jsonBody(c)).action, 20);
    if (action !== "archive" && action !== "unarchive") throw new HttpError(400, "bad action");
    if (action === "archive" && n === rfp.revision) {
      throw new HttpError(
        400,
        "The current revision cannot be archived; save a new revision to replace it.",
      );
    }
    const rev = Number.isInteger(n) && n > 0
      ? await db.revisions.setArchived(rfp.id, n, action === "archive")
      : null;
    if (!rev) throw new HttpError(404, "not found");
    return c.json({ revision: revisionMeta(rev) });
  });

  /** `{ ids: string[], action }` for a bulk route: 1 to 100 distinct ids, a known action. */
  function readBulk(
    body: Record<string, unknown>,
    allowed: Record<string, unknown>,
  ): { ids: string[]; action: string } {
    const action = s(body.action, 20);
    if (!(action in allowed)) throw new HttpError(400, "bad action");
    const raw = Array.isArray(body.ids) ? body.ids : [];
    const ids = [...new Set(raw.map((v) => s(v, 40)).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, "Select at least one row.");
    if (ids.length > 100) throw new HttpError(400, "At most 100 rows at once.");
    return { ids, action };
  }

  const STATUS_ACTIONS: Record<string, Rfp["status"]> = {
    approve: "approved",
    reject: "rejected",
    archive: "archived",
    unarchive: "approved",
  };
  async function applyStatus(rfp: Rfp, action: string): Promise<Rfp> {
    const status = STATUS_ACTIONS[action];
    if (!status) throw new HttpError(400, "bad action");
    const patch: Partial<Rfp> = { status };
    if (status === "approved" && !rfp.approvedAt) patch.approvedAt = deps.now();
    return await db.rfps.update(rfp.id, patch);
  }

  r.post("/initiatives/:id/status", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const action = s((await jsonBody(c)).action, 20);
    return c.json({ initiative: adminRfp(await applyStatus(rfp, action)) });
  });

  /** The same status change on many initiatives at once. Each id is applied
   * on its own; the response lists what failed so the rest still lands. */
  r.post("/initiatives/bulk", async (c) => {
    const body = await jsonBody(c);
    const { ids, action } = readBulk(body, STATUS_ACTIONS);
    const failed: { id: string; error: string }[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        const rfp = await db.rfps.get(id);
        if (!rfp) throw new HttpError(404, "not found");
        await applyStatus(rfp, action);
        done++;
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return c.json({ done, failed });
  });

  /**
   * The pledge fields of a request: JSON, or multipart with an optional
   * `logo` image (pinned to IPFS). Only the keys sent come back, so the same
   * reader serves adding (everything required) and editing (a subset).
   */
  async function readPledge(c: Context<Vars>, rfp: Rfp) {
    const ct = c.req.header("content-type") ?? "";
    let fields: Record<string, unknown> = {};
    let logoCid: string | undefined;
    if (ct.startsWith("multipart/form-data")) {
      const form = await c.req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
      const logo = form.get("logo");
      if (logo instanceof File && logo.size) {
        if (logo.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
        const [cid, err] = await deps.pinata.uploadImage(
          new Uint8Array(await logo.arrayBuffer()),
          LOGO_MAX_BYTES,
          "logo-" + rfp.slug,
        );
        if (!cid) throw new HttpError(400, err ?? "upload failed");
        logoCid = cid;
      }
    } else fields = await jsonBody(c);
    if (logoCid === undefined && typeof fields.logoCid === "string") {
      logoCid = s(fields.logoCid, 100);
    }
    const patch: Partial<Pick<Pledge, "company" | "amountUsd" | "url" | "note" | "logoCid">> = {};
    if (fields.company !== undefined) {
      patch.company = s(fields.company, 120);
      if (!patch.company) throw new HttpError(400, "Company name is required.");
    }
    const rawAmount = fields.amountUsd ?? fields.amount;
    if (rawAmount !== undefined && rawAmount !== "") {
      const [amount, err] = parseGoal(rawAmount);
      if (err) throw new HttpError(400, err);
      patch.amountUsd = amount!;
    }
    if (fields.url !== undefined) {
      const url = s(fields.url, 300);
      patch.url = /^https?:\/\//i.test(url) ? url : ""; // reject javascript:/data: and other schemes
    }
    if (fields.note !== undefined) patch.note = s(fields.note, 300);
    if (logoCid !== undefined) patch.logoCid = logoCid;
    const status = typeof fields.status === "string" ? s(fields.status, 20) : undefined;
    return { patch, status };
  }

  r.post("/initiatives/:id/pledges", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const { patch, status } = await readPledge(c, rfp);
    if (!patch.company) throw new HttpError(400, "Company name is required.");
    if (patch.amountUsd === undefined) throw new HttpError(400, "Amount is required.");
    const p = await db.pledges.add(rfp.id, {
      company: patch.company,
      amountUsd: patch.amountUsd,
      status: status === "received" ? "received" : "pledged",
      note: patch.note ?? "",
      url: patch.url ?? "",
      logoCid: patch.logoCid ?? "",
    });
    return c.json({ pledge: pledgeJson(config, p) }, 201);
  });

  /** Edit a pledge: any of company, amount, url, note, logo (same body as adding), and status. */
  r.patch("/initiatives/:id/pledges/:pid", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const pid = c.req.param("pid");
    const { patch, status } = await readPledge(c, rfp);
    if (status !== undefined && !["pledged", "received", "withdrawn"].includes(status)) {
      throw new HttpError(400, "bad status");
    }
    let next = await db.pledges.get(rfp.id, pid);
    if (!next) throw new HttpError(404, "not found");
    if (Object.keys(patch).length) next = await db.pledges.update(rfp.id, pid, patch);
    if (status !== undefined) {
      await db.pledges.setStatus(rfp.id, pid, status as PledgeStatus);
      next = await db.pledges.get(rfp.id, pid);
    }
    return c.json({ ok: true, pledge: pledgeJson(config, next!) });
  });

  r.delete("/initiatives/:id/pledges/:pid", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    await db.pledges.remove(rfp.id, c.req.param("pid"));
    return c.json({ ok: true });
  });

  r.post("/initiatives/:id/donations/recheck", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const tx = s((await jsonBody(c)).txHash, 80).toLowerCase();
    if (!TX_HASH_RE.test(tx)) throw new HttpError(400, "malformed tx hash");
    if (!rfp.safeAddress || !Object.keys(await chain.activeTokens()).length) {
      throw new HttpError(503, "chain unavailable or no Safe");
    }
    const v = await chain.verifyDonation(tx, rfp.safeAddress);
    if (v.found && !v.pending) await db.donations.record(rfp.id, tx, v, "tx");
    return c.json({ verification: v });
  });

  r.post("/initiatives/:id/sync-donations", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    if (!rfp.safeAddress) throw new HttpError(400, "no Safe deployed");
    if (!(await db.rateLimit("safesync:" + rfp.id, 1, 60))) {
      throw new HttpError(429, "synced less than a minute ago");
    }
    return c.json({ safeSync: await syncSafe(deps, rfp) });
  });

  r.get("/initiatives/:id/safe-deploy-params", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const [ok, why] = signersConfigured(config.operationalSigners);
    if (!ok) return c.json({ enabled: false, reason: why }, 503);
    return c.json({
      enabled: true,
      chainId: CHAIN_ID,
      factory: SAFE_PROXY_FACTORY,
      calldata: safeDeployCalldata(config.operationalSigners, rfp.slug),
      signers: config.operationalSigners,
      threshold: SAFE_THRESHOLD,
      alreadyDeployed: rfp.safeAddress || null,
    });
  });

  /** Verify a deploy tx on-chain, then store the verified Safe address. */
  /**
   * Bind a Safe to the initiative: either the tx hash of a deploy made from
   * the admin panel, or the address of a Safe that already exists. Both go
   * through the same on-chain check (owners, threshold, canonical proxy).
   */
  r.post("/initiatives/:id/safe-confirm", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const body = await jsonBody(c);
    let address: string;
    if (s(body.address, 64)) {
      const given = s(body.address, 64);
      if (!isAddress(given)) {
        return c.json({ status: "error", detail: "malformed Safe address" }, 400);
      }
      address = toChecksum(given);
    } else {
      const tx = s(body.txHash, 80).toLowerCase();
      if (!TX_HASH_RE.test(tx)) {
        return c.json({ status: "error", detail: "malformed tx hash" }, 400);
      }
      const [found, err] = await chain.extractDeployedSafe(tx);
      if (err === "pending") {
        return c.json({
          status: "pending",
          detail: "waiting for the deploy tx to be mined",
        });
      }
      if (err) return c.json({ status: "error", detail: err }, 400);
      address = found!;
    }
    const [ok, detail] = await chain.verifySafe(address, config.operationalSigners);
    if (!ok) {
      return c.json({
        status: "error",
        detail: `Safe at ${address} REJECTED: ${detail}`,
      }, 400);
    }
    if (rfp.safeAddress && rfp.safeAddress.toLowerCase() !== address.toLowerCase()) {
      return c.json({
        status: "error",
        detail: "this initiative already has a different Safe: " + rfp.safeAddress,
      }, 409);
    }
    const other = await db.rfps.bySafe(address);
    if (other && other.id !== rfp.id) {
      return c.json({
        status: "error",
        detail: `that Safe is already assigned to another initiative (${other.slug})`,
      }, 409);
    }
    if (!rfp.safeAddress) await db.rfps.update(rfp.id, { safeAddress: address });
    return c.json({ status: "ok", address, detail });
  });

  /** The patch a moderation action makes on a comment, or a 400/409. */
  async function commentPatch(row: Comment, action: string): Promise<Partial<Comment>> {
    if (
      ["accept", "review", "feature", "feature-front"].includes(action) &&
      (row.parentId || row.status !== "published")
    ) {
      throw new HttpError(400, "only a published top-level entry");
    }
    if (action === "publish") return { status: "published" };
    if (action === "discard") return { status: "discarded" };
    if (action === "accept" && row.type === "suggestion") return { accepted: true, reviewed: true };
    if (action === "review" && row.type === "suggestion") return { reviewed: true };
    if (action === "feature") return { featured: 1, featuredAt: deps.now() };
    if (action === "feature-front") {
      // Max 3 on the front page, never automatic: the 4th toggle is refused.
      if (row.featured !== 2 && (await db.comments.frontPage()).length >= 3) {
        throw new HttpError(
          409,
          "The front page already has 3 featured entries. Unfeature one first.",
        );
      }
      return { featured: 2, featuredAt: deps.now() };
    }
    if (action === "unfeature") return { featured: 0, featuredAt: 0 };
    if (action === "unreport") return { reports: 0 };
    throw new HttpError(400, "bad action");
  }

  /** Bulk-safe moderation actions: the ones with no per-row precondition. */
  const BULK_COMMENT_ACTIONS: Record<string, true> = {
    publish: true,
    discard: true,
    unreport: true,
  };

  r.post("/comments/bulk", async (c) => {
    const body = await jsonBody(c);
    const { ids, action } = readBulk(body, BULK_COMMENT_ACTIONS);
    const failed: { id: string; error: string }[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        const row = await db.comments.get(id);
        if (!row) throw new HttpError(404, "not found");
        await db.comments.set(row.id, await commentPatch(row, action));
        done++;
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return c.json({ done, failed });
  });

  r.post("/comments/:id/:action", async (c) => {
    const row = await db.comments.get(c.req.param("id"));
    if (!row) throw new HttpError(404, "not found");
    const next = await db.comments.set(row.id, await commentPatch(row, c.req.param("action")));
    const rfp = await db.rfps.get(row.rfpId);
    return c.json({
      comment: adminCommentJson(next!, liveRoles(await deps.admins.set(), next!.address, rfp), rfp),
    });
  });

  /**
   * Funder leads: the ONLY reader of the private funders field besides the
   * manage page. Never link from a public page; never add a public route.
   */
  r.get("/leads", async (c) => {
    const all = await db.rfps.list(["pending", "approved", "rejected", "archived"]);
    const rows = all.filter((x) => x.funders.trim()).map((x) => ({
      id: x.id,
      title: x.title,
      slug: x.slug,
      type: x.type,
      status: x.status,
      goalUsd: x.goalUsd,
      funders: x.funders,
      contact: x.contact,
      createdAt: x.createdAt,
    }));
    return c.json({ rows });
  });

  /**
   * A content logo (content/rfps/logos/<name>), pinned to IPFS once: the same bytes
   * come back with the stored CID, new bytes replace it. The sync then maps
   * the name in a backers line to the CID. Multipart: `name`, `image`.
   */
  r.post("/logos", async (c) => {
    if (!deps.pinata.enabled) throw new HttpError(503, "Uploads are not enabled.");
    const form = await c.req.formData().catch(() => null);
    const name = s(form?.get("name"), 100).toLowerCase();
    if (!LOGO_NAME_RE.test(name)) {
      throw new HttpError(400, "Logo names are lowercase file names: png, jpg or webp.");
    }
    const image = form?.get("image");
    if (!(image instanceof File) || !image.size) throw new HttpError(400, "Send the image file.");
    if (image.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
    const bytes = new Uint8Array(await image.arrayBuffer());
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const have = await db.logos.get(name);
    if (have && have.sha256 === sha256) {
      return c.json({ name, cid: have.cid, logoUrl: ipfsUrl(config, have.cid), reused: true });
    }
    const [cid, err] = await deps.pinata.uploadImage(bytes, LOGO_MAX_BYTES, "content-logo-" + name);
    if (err) throw new HttpError(400, err);
    await db.logos.set(name, cid!, sha256);
    return c.json({ name, cid, logoUrl: ipfsUrl(config, cid!), reused: false });
  });

  /** Push-based content sync: the repo's content/rfps/*.md, sent by scripts/sync-content.ts. */
  r.post("/sync-content", async (c) => {
    const body = await jsonBody(c);
    const files = Array.isArray(body.files) ? body.files : [];
    const clean = files
      .filter((f): f is { name: string; text: string } =>
        f && typeof f === "object" && typeof f.name === "string" &&
        typeof f.text === "string"
      )
      .map((f) => ({ name: f.name.slice(0, 200), text: f.text.slice(0, 200_000) }));
    return c.json(await syncContent(db, clean));
  });

  return r;
}
