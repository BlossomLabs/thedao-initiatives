import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { adminCommentJson, adminRfp, donationJson, pledgeJson, revisionMeta } from "../lib/json.ts";
import {
  DOMAIN_RE,
  parseGoal,
  TX_HASH_RE,
  validateForumUrl,
  validateText,
} from "../lib/validate.ts";
import { decimalsOf } from "./initiatives.ts";
import { safeDeployCalldata, signersConfigured } from "../chain/safe.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import { syncContent } from "../services/content.ts";
import { syncSafe } from "../services/safe-api.ts";
import { liveRoles } from "../services/roles.ts";
import type { Comment, PledgeStatus, Rfp } from "../db/types.ts";
import { CHAIN_ID, MAX_FUNDERS, SAFE_PROXY_FACTORY, SAFE_THRESHOLD } from "../config.ts";

export const LOGO_MAX_BYTES = 1024 * 1024;

export function adminRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config, chain, ens } = deps;
  r.use("*", requireAdmin);

  const rfpOr404 = async (id: string): Promise<Rfp> => {
    const rfp = await db.rfps.get(id);
    if (!rfp) throw new HttpError(404, "not found");
    return rfp;
  };
  const withInitiative = async (rows: Comment[]) => {
    const out = [];
    for (const cm of rows) {
      const rfp = await db.rfps.get(cm.rfpId);
      out.push(adminCommentJson(cm, liveRoles(config, cm.address, rfp), rfp));
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
        summary: await db.fundingSummary(rfp.id),
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

  r.get("/initiatives/:id", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const [signersOk, signersDetail] = signersConfigured(config.operationalSigners);
    return c.json({
      initiative: adminRfp(rfp),
      revisions: (await db.revisions.list(rfp.id, true)).map(revisionMeta),
      summary: await db.fundingSummary(rfp.id),
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

  r.patch("/initiatives/:id", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const body = await jsonBody(c);
    const patch: Partial<Rfp> = {};
    // Title, summary and details are revisioned: validated together against
    // the current text and written as one new revision after the rest.
    const textGiven = ["title", "summary", "details"].some((k) => body[k] !== undefined);
    const text = textGiven
      ? validateText({
        title: body.title === undefined ? rfp.title : s(body.title),
        summary: body.summary === undefined ? rfp.summary : s(body.summary),
        details: body.details === undefined ? rfp.details : s(body.details, 100_000),
      })
      : null;
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
    if (body.type !== undefined) patch.type = body.type === "grant" ? "grant" : "rfp";
    if (body.contact !== undefined) patch.contact = s(body.contact, 200);
    if (body.funders !== undefined) patch.funders = s(body.funders, MAX_FUNDERS);
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
    let next = Object.keys(patch).length ? await db.rfps.update(rfp.id, patch) : rfp;
    if (text) {
      next = (await db.rfps.revise(rfp.id, text, {
        author: c.var.user!.address,
        source: "admin",
      })).rfp;
    }
    return c.json({ initiative: adminRfp(next) });
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

  r.post("/initiatives/:id/status", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const action = s((await jsonBody(c)).action, 20);
    const map: Record<string, Rfp["status"]> = {
      approve: "approved",
      reject: "rejected",
      archive: "archived",
      unarchive: "approved",
    };
    const status = map[action];
    if (!status) throw new HttpError(400, "bad action");
    const patch: Partial<Rfp> = { status };
    if (status === "approved" && !rfp.approvedAt) patch.approvedAt = deps.now();
    return c.json({ initiative: adminRfp(await db.rfps.update(rfp.id, patch)) });
  });

  /** Add a pledge. JSON, or multipart with an optional `logo` image (pinned to IPFS). */
  r.post("/initiatives/:id/pledges", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const ct = c.req.header("content-type") ?? "";
    let fields: Record<string, unknown> = {};
    let logoCid = "";
    if (ct.startsWith("multipart/form-data")) {
      const form = await c.req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
      const logo = form.get("logo");
      if (logo instanceof File && logo.size) {
        if (logo.size > LOGO_MAX_BYTES) {
          throw new HttpError(400, "Logo must be under 1 MB.");
        }
        const [cid, err] = await deps.pinata.uploadImage(
          new Uint8Array(await logo.arrayBuffer()),
          LOGO_MAX_BYTES,
          "logo-" + rfp.slug,
        );
        if (!cid) throw new HttpError(400, err ?? "upload failed");
        logoCid = cid;
      }
    } else fields = await jsonBody(c);
    const company = s(fields.company, 120);
    if (!company) throw new HttpError(400, "Company name is required.");
    const [amount, err] = parseGoal(fields.amountUsd ?? fields.amount);
    if (err) throw new HttpError(400, err);
    const status: PledgeStatus = fields.status === "received" ? "received" : "pledged";
    let url = s(fields.url, 300);
    if (url && !/^https?:\/\//i.test(url)) url = ""; // reject javascript:/data: and other schemes
    if (!logoCid && typeof fields.logoCid === "string") logoCid = s(fields.logoCid, 100);
    const p = await db.pledges.add(rfp.id, {
      company,
      amountUsd: amount!,
      status,
      note: s(fields.note, 300),
      url,
      logoCid,
    });
    return c.json({ pledge: pledgeJson(config, p) }, 201);
  });

  r.patch("/initiatives/:id/pledges/:pid", async (c) => {
    const rfp = await rfpOr404(c.req.param("id"));
    const status = s((await jsonBody(c)).status, 20);
    if (!["pledged", "received", "withdrawn"].includes(status)) {
      throw new HttpError(400, "bad status");
    }
    if (
      !(await db.pledges.setStatus(rfp.id, c.req.param("pid"), status as PledgeStatus))
    ) throw new HttpError(404, "not found");
    return c.json({ ok: true });
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

  r.post("/comments/:id/:action", async (c) => {
    const row = await db.comments.get(c.req.param("id"));
    if (!row) throw new HttpError(404, "not found");
    const action = c.req.param("action");
    if (
      ["accept", "review", "feature", "feature-front"].includes(action) &&
      (row.parentId || row.status !== "published")
    ) {
      throw new HttpError(400, "only a published top-level entry");
    }
    let patch: Partial<Comment> | null = null;
    if (action === "publish") patch = { status: "published" };
    else if (action === "discard") patch = { status: "discarded" };
    else if (action === "accept" && row.type === "suggestion") {
      patch = { accepted: true, reviewed: true };
    } else if (action === "review" && row.type === "suggestion") {
      patch = { reviewed: true };
    } else if (action === "feature") patch = { featured: 1, featuredAt: deps.now() };
    else if (action === "feature-front") {
      // Max 3 on the front page, never automatic: the 4th toggle is refused.
      if (row.featured !== 2 && (await db.comments.frontPage()).length >= 3) {
        throw new HttpError(
          409,
          "The front page already has 3 featured entries. Unfeature one first.",
        );
      }
      patch = { featured: 2, featuredAt: deps.now() };
    } else if (action === "unfeature") patch = { featured: 0, featuredAt: 0 };
    else if (action === "unreport") patch = { reports: 0 };
    if (!patch) throw new HttpError(400, "bad action");
    const next = await db.comments.set(row.id, patch);
    const rfp = await db.rfps.get(row.rfpId);
    return c.json({ comment: adminCommentJson(next!, liveRoles(config, next!.address, rfp), rfp) });
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
