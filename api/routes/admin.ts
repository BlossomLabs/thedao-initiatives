import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { auditContext, auditedItem, recordAudit } from "../services/audit.ts";
import { INITIATIVE_CHANGED } from "../lib/initiative-identity.ts";
import { assertFields, formBody, jsonBody, s } from "../lib/body.ts";
import { assertRecentAuth, requireAdmin, requireRecentAuth } from "../middleware/auth.ts";
import { clearSessionCookie } from "../lib/session-cookie.ts";
import {
  adminCardInitiative,
  adminCommentJson,
  adminInitiative,
  donationJson,
  ipfsUrl,
  pledgeJson,
  revisionMeta,
} from "../lib/json.ts";
import { capped, DOMAIN_RE, parseGoal, TX_HASH_RE, validateHttpsLink } from "../lib/validate.ts";
import { decimalsOf } from "./initiatives.ts";
import { LIMITS } from "../../shared/draft/mod.ts";
import { predictSafeAddress, safeDeployCalldata, signersConfigured } from "../chain/safe.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import { LOGO_NAME_RE, syncContent } from "../services/content.ts";
import { refreshLedger } from "../services/ledger.ts";
import { exportBackup, restoreBackup, validateBackup } from "../services/backup.ts";
import { badgeHolders, liveRoles } from "../services/roles.ts";
import type { AdminEntry } from "../services/admins.ts";
import type { Comment, Initiative, Pledge, PledgeStatus } from "../db/types.ts";
import { CHAIN_ID, LOGO_MAX_BYTES, SAFE_PROXY_FACTORY, SAFE_THRESHOLD } from "../config.ts";

export function adminRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config, chain, ens } = deps;
  r.use("*", requireAdmin);

  r.post("/sessions/revoke", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address"]);
    const address = s(body.address, 60);
    if (!isAddress(address)) throw new HttpError(400, "that is not an Ethereum address");
    auditContext(c, { target: address });
    const revoked = await db.sessions.revokeAll(address);
    if (address.toLowerCase() === c.var.user!.address.toLowerCase()) {
      c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    }
    return c.json({ ok: true, revoked });
  });

  r.post("/sessions/revoke-all", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["confirmation"]);
    if (body.confirmation !== "revoke all sessions") {
      throw new HttpError(400, "Confirm global revocation with: revoke all sessions");
    }
    await db.sessions.revokeGlobal();
    c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    return c.json({ ok: true });
  });

  /** Admin routes address an initiative by slug (the URL) or by id (older links). */
  const initiativeOr404 = async (idOrSlug: string, mutation = false): Promise<Initiative> => {
    const byId = await db.initiatives.get(idOrSlug);
    if (byId) return byId;
    const initiative = await db.initiatives.bySlug(idOrSlug);
    if (mutation && await db.initiatives.isReusedSlug(idOrSlug)) {
      throw new HttpError(409, INITIATIVE_CHANGED);
    }
    if (!initiative) throw new HttpError(404, "not found");
    return initiative;
  };
  const withInitiative = async (rows: Comment[]) => {
    const out = [];
    const admins = await deps.admins.set();
    const experts = await badgeHolders(deps.chain, rows.map((cm) => cm.address));
    for (const cm of rows) {
      const initiative = await db.initiatives.get(cm.rfpId);
      const live = liveRoles(admins, cm.address, initiative, experts.has(cm.address.toLowerCase()));
      out.push(adminCommentJson(cm, live, initiative));
    }
    return out;
  };

  r.get("/dashboard", async (c) => {
    const [pending, approved, other] = await Promise.all([
      db.initiatives.list(["pending"]),
      db.initiatives.list(["approved"]),
      db.initiatives.list(["rejected", "archived"]),
    ]);
    const rows = [];
    // Maintenance pauses the balance refresh the dashboard would trigger.
    const revalidate = !(await deps.maintenance.on());
    for (const initiative of [...pending, ...approved, ...other]) {
      rows.push({
        initiative: adminCardInitiative(initiative),
        summary: await deps.funding.summary(initiative, revalidate),
        safeSync: initiative.safeAddress ? await db.meta.safeSync(initiative.id) : null,
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
        refreshMinutes: config.safeSyncTtlSecs / 60,
      },
      signers: {
        ok: signersOk,
        detail: signersDetail,
        list: config.operationalSigners,
        threshold: SAFE_THRESHOLD,
      },
    });
  });

  // Maintenance mode: pause every write on the site (services/maintenance.ts).
  r.get("/maintenance", async (c) => c.json(await deps.maintenance.fresh()));
  r.post("/maintenance/enter", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["note"]);
    return c.json(await deps.maintenance.enter(c.var.user!.address, s(body.note, 200)));
  });
  r.post("/maintenance/exit", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    return c.json(await deps.maintenance.exit(c.var.user!.address));
  });

  // The whole database as one file, and the way back (services/backup.ts).
  r.get("/backup", requireRecentAuth(deps.now), async (c) => {
    const backup = await exportBackup(db, deps.now);
    const stamp = backup.exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return c.body(JSON.stringify(backup), 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="thedao-kv-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    });
  });
  r.post(
    "/restore",
    requireRecentAuth(deps.now),
    bodyLimit({
      maxSize: 32 * 1024 * 1024,
      onError: (c) => c.json({ error: "Backup file too large (32 MB max)." }, 413),
    }),
    async (c) => {
      const body = await jsonBody(c, ["mode", "backup"]);
      const mode = body.mode ?? "merge";
      if (mode !== "merge" && mode !== "replace") {
        throw new HttpError(400, "mode must be merge or replace");
      }
      if (!(await deps.maintenance.fresh()).on) {
        throw new HttpError(409, "Turn maintenance mode on before restoring a backup.");
      }
      const backup = validateBackup(body.backup);
      auditContext(c, { detail: mode });
      const result = await restoreBackup(db, backup, mode, deps.now);
      deps.log(
        `backup restore (${mode}): written=${result.written} skipped=${result.skipped} claims=${result.claimsRebuilt}`,
      );
      return c.json(result);
    },
  );

  // The admin list. ADMIN_ADDRESSES entries are fixed; the rest live in KV.
  const adminsJson = (admins: AdminEntry[], c: Context<Vars>) =>
    c.json({ admins, you: c.var.user!.address });
  r.get("/admins", async (c) => adminsJson(await deps.admins.list(), c));
  r.post("/admins", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address"]);
    const address = s(body.address, 60);
    auditContext(c, { target: address });
    const admins = await deps.admins.add(address);
    recordAudit(deps, c, {
      action: "session.admin_revoke",
      targetKind: "wallet",
      target: address,
      outcome: "success",
    });
    return adminsJson(admins, c);
  });
  r.delete("/admins/:address", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    const address = c.req.param("address");
    const admins = await deps.admins.remove(address, c.var.user!.address);
    recordAudit(deps, c, {
      action: "session.admin_revoke",
      targetKind: "wallet",
      target: address,
      outcome: "success",
    });
    return adminsJson(admins, c);
  });

  r.get("/initiatives/:id", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"));
    const [signersOk, signersDetail] = signersConfigured(config.operationalSigners);
    return c.json({
      initiative: adminInitiative(initiative),
      revisions: (await db.revisions.list(initiative.id, true)).map(revisionMeta),
      summary: await deps.funding.summary(initiative, !(await deps.maintenance.on())),
      pledges: (await db.pledges.list(initiative.id, true)).map((p) => pledgeJson(config, p)),
      donations: (await db.donations.list(initiative.id, false)).map((d) =>
        donationJson(d, decimalsOf)
      ),
      safeSync: initiative.safeAddress ? await db.meta.safeSync(initiative.id) : null,
      signers: {
        ok: signersOk,
        detail: signersDetail,
        list: config.operationalSigners,
        threshold: SAFE_THRESHOLD,
      },
    });
  });

  /**
   * The admin settings of an initiative: board pin, owner and paid out. The
   * text and the page facts are edited on the initiative's edit page, through
   * the routes a proposer uses.
   */
  r.patch("/initiatives/:id", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const body = await jsonBody(c, ["sortRank", "paidOutUsd", "proposer"]);
    if (body.paidOutUsd !== undefined || body.proposer !== undefined) assertRecentAuth(c, deps.now);
    const patch: Partial<Initiative> = {};
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
    const next = Object.keys(patch).length
      ? await db.initiatives.update(initiative.id, patch)
      : initiative;
    return c.json({ initiative: adminInitiative(next) });
  });

  /** Hide a superseded revision from the public history, or show it again. */
  r.post("/initiatives/:id/revisions/:n", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const n = Number(c.req.param("n"));
    const action = s((await jsonBody(c, ["action"])).action, 20);
    auditContext(c, { target: `${initiative.id}:${n}`, detail: action });
    if (action !== "archive" && action !== "unarchive") throw new HttpError(400, "bad action");
    if (action === "archive" && n === initiative.revision) {
      throw new HttpError(
        400,
        "The current revision cannot be archived; save a new revision to replace it.",
      );
    }
    const rev = Number.isInteger(n) && n > 0
      ? await db.revisions.setArchived(initiative.id, n, action === "archive")
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
    if (!Object.hasOwn(allowed, action)) throw new HttpError(400, "bad action");
    const raw = Array.isArray(body.ids) ? body.ids : [];
    const ids = [...new Set(raw.map((v) => s(v, 40)).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, "Select at least one row.");
    if (ids.length > 100) throw new HttpError(400, "At most 100 rows at once.");
    return { ids, action };
  }

  const STATUS_ACTIONS: Record<string, Initiative["status"]> = {
    approve: "approved",
    reject: "rejected",
    archive: "archived",
    unarchive: "approved",
  };
  async function applyStatus(initiative: Initiative, action: string): Promise<Initiative> {
    if (!Object.hasOwn(STATUS_ACTIONS, action)) throw new HttpError(400, "bad action");
    const status = STATUS_ACTIONS[action];
    if (status !== "approved") return await db.initiatives.update(initiative.id, { status });
    // Deploy first, approve second: a live initiative always has its Safe.
    if (!initiative.safeAddress) {
      throw new HttpError(400, "Deploy the Safe first; approval needs a deployed, verified Safe.");
    }
    return await db.initiatives.unarchive(initiative.id);
  }

  r.post("/initiatives/:id/status", requireRecentAuth(deps.now), async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const action = s((await jsonBody(c, ["action"])).action, 20);
    auditContext(c, { target: initiative.id, detail: action });
    return c.json({ initiative: adminInitiative(await applyStatus(initiative, action)) });
  });

  /** The same status change on many initiatives at once. Each id is applied
   * on its own; the response lists what failed so the rest still lands. */
  r.post("/initiatives/bulk", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["ids", "action"]);
    const { ids, action } = readBulk(body, STATUS_ACTIONS);
    auditContext(c, { detail: action });
    const failed: { id: string; error: string }[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        await auditedItem(deps, c, {
          action: "initiative.status",
          targetKind: "initiative",
          target: id,
          detail: action,
        }, async () => {
          const initiative = await db.initiatives.get(id);
          if (!initiative) throw new HttpError(404, "not found");
          await applyStatus(initiative, action);
        });
        done++;
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : "failed" });
      }
    }
    auditContext(c, { outcome: failed.length ? done ? "partial" : "failure" : "success" });
    return c.json({ done, failed });
  });

  /**
   * The pledge fields of a request: JSON, or multipart with an optional
   * `logo` image (pinned to IPFS). Only the keys sent come back, so the same
   * reader serves adding (everything required) and editing (a subset).
   */
  const PLEDGE_NOTE_CHARS = 300;
  async function readPledge(c: Context<Vars>, initiative: Initiative) {
    const ct = c.req.header("content-type") ?? "";
    let fields: Record<string, unknown> = {};
    let logoCid: string | undefined;
    let logo: FormDataEntryValue | null = null;
    const allowed = ["company", "amount", "url", "note", "status"];
    if (ct.startsWith("multipart/form-data")) {
      const form = await formBody(c, [...allowed, "logo"]);
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
      logo = form.get("logo");
    } else fields = await jsonBody(c, allowed);
    const patch: Partial<Pick<Pledge, "company" | "amountUsd" | "url" | "note" | "logoCid">> = {};
    // Past a cap is refused with the message, never cut.
    if (fields.company !== undefined) {
      patch.company = capped(fields.company, LIMITS.BACKER_ORG, "The company name");
      if (!patch.company) throw new HttpError(400, "Company name is required.");
    }
    const rawAmount = fields.amount;
    if (rawAmount !== undefined && rawAmount !== "") {
      const [amount, err] = parseGoal(rawAmount);
      if (err) throw new HttpError(400, err);
      patch.amountUsd = amount!;
    }
    if (fields.url !== undefined) {
      const [url, err] = validateHttpsLink(fields.url);
      if (err) throw new HttpError(400, err);
      patch.url = url!;
    }
    if (fields.note !== undefined) {
      patch.note = capped(fields.note, PLEDGE_NOTE_CHARS, "The note");
    }
    // Validate fields before uploading anything to the external provider.
    if (logo instanceof File && logo.size) {
      if (logo.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
      const [cid, err] = await deps.pinata.uploadImage(
        new Uint8Array(await logo.arrayBuffer()),
        LOGO_MAX_BYTES,
        "logo-" + initiative.slug,
      );
      if (!cid) throw new HttpError(400, err ?? "upload failed");
      logoCid = cid;
    }
    if (logoCid !== undefined) patch.logoCid = logoCid;
    const status = typeof fields.status === "string" ? s(fields.status, 20) : undefined;
    return { patch, status };
  }

  r.post("/initiatives/:id/pledges", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const { patch, status } = await readPledge(c, initiative);
    if (!patch.company) throw new HttpError(400, "Company name is required.");
    if (patch.amountUsd === undefined) throw new HttpError(400, "Amount is required.");
    const p = await db.pledges.add(initiative.id, {
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
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const pid = c.req.param("pid");
    const { patch, status } = await readPledge(c, initiative);
    if (status !== undefined && !["pledged", "received", "withdrawn"].includes(status)) {
      throw new HttpError(400, "bad status");
    }
    let next = await db.pledges.get(initiative.id, pid);
    if (!next) throw new HttpError(404, "not found");
    if (Object.keys(patch).length) next = await db.pledges.update(initiative.id, pid, patch);
    if (status !== undefined) {
      await db.pledges.setStatus(initiative.id, pid, status as PledgeStatus);
      next = await db.pledges.get(initiative.id, pid);
    }
    return c.json({ ok: true, pledge: pledgeJson(config, next!) });
  });

  r.delete("/initiatives/:id/pledges/:pid", async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    await db.pledges.remove(initiative.id, c.req.param("pid"));
    return c.json({ ok: true });
  });

  r.post("/initiatives/:id/donations/recheck", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const tx = s((await jsonBody(c, ["txHash"])).txHash, 80).toLowerCase();
    if (!TX_HASH_RE.test(tx)) throw new HttpError(400, "malformed tx hash");
    if (!initiative.safeAddress || !Object.keys(await chain.activeTokens()).length) {
      throw new HttpError(503, "chain unavailable or no Safe");
    }
    const v = await chain.verifyDonation(tx, initiative.safeAddress);
    if (v.found && !v.pending) await db.donations.record(initiative.id, tx, v, "tx");
    return c.json({ verification: v });
  });

  r.post("/initiatives/:id/sync-donations", async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    if (!initiative.safeAddress) throw new HttpError(400, "no Safe deployed");
    if (!(await db.rateLimit("safesync:" + initiative.id, 1, 60))) {
      throw new HttpError(429, "synced less than a minute ago");
    }
    return c.json({ safeSync: await refreshLedger(deps, initiative, true) });
  });

  /** What the admin's wallet sends to deploy this initiative's Safe, and where it lands. */
  r.get("/initiatives/:id/safe-deploy-params", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const [ok, why] = signersConfigured(config.operationalSigners);
    if (!ok) return c.json({ enabled: false, reason: why }, 503);
    const key = initiative.safeDeploymentKey ?? initiative.slug;
    const address = initiative.safeAddress || predictSafeAddress(config.operationalSigners, key);
    // "Deployed" is on-chain truth, not just our binding: a deploy the browser
    // lost track of (wallet mined it under another hash) must not be sent
    // again, since CREATE2 at an occupied address can only revert.
    const deployed = Boolean(initiative.safeAddress) || await chain.hasCode(address);
    return c.json({
      enabled: true,
      chainId: CHAIN_ID,
      factory: SAFE_PROXY_FACTORY,
      calldata: safeDeployCalldata(config.operationalSigners, key),
      signers: config.operationalSigners,
      threshold: SAFE_THRESHOLD,
      address,
      deployed,
    });
  });

  /**
   * Bind the Safe once it exists. The truth is code at the predicted CREATE2
   * address, not a tx hash: a Safe wallet or a sped-up tx mines under another
   * hash, so the browser watches its own receipt for a revert and asks here
   * until the Safe is there. What is there must pass the on-chain check
   * (owners, threshold, canonical proxy) and be unbound elsewhere.
   */
  r.post("/initiatives/:id/safe-confirm", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    if (initiative.safeAddress) {
      return c.json({ status: "ok", address: initiative.safeAddress, detail: "verified earlier" });
    }
    const [ok, why] = signersConfigured(config.operationalSigners);
    if (!ok) return c.json({ status: "error", detail: why }, 503);
    const address = predictSafeAddress(
      config.operationalSigners,
      initiative.safeDeploymentKey ?? initiative.slug,
    );
    if (!(await chain.hasCode(address))) {
      auditContext(c, { outcome: "pending" });
      return c.json({ status: "pending", detail: `no Safe at ${address} yet` });
    }
    const [good, detail] = await chain.verifySafe(address, config.operationalSigners);
    if (!good) {
      return c.json({ status: "error", detail: `Safe at ${address} REJECTED: ${detail}` }, 400);
    }
    const other = await db.initiatives.bySafe(address);
    if (other && other.id !== initiative.id) {
      return c.json({
        status: "error",
        detail: `that Safe is already assigned to another initiative (${other.slug})`,
      }, 409);
    }
    await db.initiatives.update(initiative.id, { safeAddress: address });
    return c.json({ status: "ok", address, detail });
  });

  /** The patch a moderation action makes on a comment, or a 400/409. */
  function commentPatch(row: Comment, action: string): Partial<Comment> {
    if (
      ["review", "feature"].includes(action) &&
      (row.parentId || row.status !== "published")
    ) {
      throw new HttpError(400, "only a published top-level entry");
    }
    if (action === "publish") return { status: "published" };
    if (action === "discard") return { status: "discarded" };
    if (action === "review" && row.type === "suggestion") return { reviewed: true };
    if (action === "feature") return { featured: 1, featuredAt: deps.now() };
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
    const body = await jsonBody(c, ["ids", "action"]);
    const { ids, action } = readBulk(body, BULK_COMMENT_ACTIONS);
    auditContext(c, { detail: action });
    const failed: { id: string; error: string }[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        await auditedItem(deps, c, {
          action: "comment.moderate",
          targetKind: "comment",
          target: id,
          detail: action,
        }, async () => {
          const row = await db.comments.get(id);
          if (!row) throw new HttpError(404, "not found");
          await db.comments.set(row.id, commentPatch(row, action));
        });
        done++;
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : "failed" });
      }
    }
    auditContext(c, { outcome: failed.length ? done ? "partial" : "failure" : "success" });
    return c.json({ done, failed });
  });

  r.post("/comments/:id/:action", async (c) => {
    await jsonBody(c, []);
    auditContext(c, { detail: c.req.param("action") });
    const row = await db.comments.get(c.req.param("id"));
    if (!row) throw new HttpError(404, "not found");
    const next = await db.comments.set(row.id, commentPatch(row, c.req.param("action")));
    const initiative = await db.initiatives.get(row.rfpId);
    return c.json({
      comment: adminCommentJson(
        next!,
        liveRoles(
          await deps.admins.set(),
          next!.address,
          initiative,
          Boolean(next!.address) && await deps.chain.hasBadge(next!.address),
        ),
        initiative,
      ),
    });
  });

  /**
   * Funder leads: the ONLY reader of the private funders field besides the
   * manage page. Never link from a public page; never add a public route.
   */
  r.get("/leads", requireRecentAuth(deps.now), async (c) => {
    const all = await db.initiatives.list(["pending", "approved", "rejected", "archived"]);
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
   * A content logo (content/initiatives/logos/<name>), pinned to IPFS once: the same bytes
   * come back with the stored CID, new bytes replace it. The sync then maps
   * the name in a backers line to the CID. Multipart: `name`, `image`.
   */
  r.post("/logos", async (c) => {
    if (!deps.pinata.enabled) throw new HttpError(503, "Uploads are not enabled.");
    const form = await formBody(c, ["name", "image"]);
    const name = s(form.get("name"), 100).toLowerCase();
    if (!LOGO_NAME_RE.test(name)) {
      throw new HttpError(400, "Logo names are lowercase file names: png, jpg or webp.");
    }
    auditContext(c, { target: name });
    const image = form.get("image");
    if (!(image instanceof File) || !image.size) throw new HttpError(400, "Send the image file.");
    if (image.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
    const bytes = new Uint8Array(await image.arrayBuffer());
    // Legacy pins were not decoded. Only reuse pins produced by this normalization policy.
    const sha256 = "raster-v1:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
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

  /** Push-based content sync: the repo's content/initiatives/*.md, sent by scripts/sync-content.ts. */
  r.post("/sync-content", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["files"]);
    const files = Array.isArray(body.files) ? body.files : [];
    files.forEach((file, i) => {
      if (file && typeof file === "object") assertFields(file, ["name", "text"], `files[${i}].`);
    });
    const clean = files
      .filter((f): f is { name: string; text: string } =>
        f && typeof f === "object" && typeof f.name === "string" &&
        typeof f.text === "string"
      )
      .map((f) => ({ name: f.name.slice(0, 200), text: f.text.slice(0, 200_000) }));
    const result = await syncContent(
      db,
      clean,
      (name, run) =>
        auditedItem(deps, c, { action: "content.item", targetKind: "content", target: name }, run),
    );
    auditContext(c, {
      outcome: result.errors.length
        ? result.created + result.updated ? "partial" : "failure"
        : "success",
    });
    return c.json(result);
  });

  return r;
}
