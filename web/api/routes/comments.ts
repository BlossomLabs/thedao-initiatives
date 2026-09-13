/** Community Questions & Suggestions per initiative (SPEC-community-qa v1),
 * with SIWE sessions in place of per-action signatures. */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { assertInitiativeIdentity } from "../lib/initiative-identity.ts";
import { jsonBody, s } from "../lib/body.ts";
import { requireAuth } from "../middleware/auth.ts";
import { type CommentJson, commentJson } from "../lib/json.ts";
import { EMAIL_RE } from "../lib/validate.ts";
import { assertEthNameOwned } from "../services/names.ts";
import {
  commentRoles,
  liveRoles,
  ROLE_FAST_LANE,
  storedRoles,
  voteEligible,
} from "../services/roles.ts";
import type { Comment, CommentType } from "../db/types.ts";
import { COMMENT_BODY_MAX } from "../config.ts";

export const COMMENT_TYPES = new Set<CommentType>(["suggestion", "question", "other"]);
export const COMMENT_TOPICS = new Set([
  "budget",
  "milestones",
  "scope",
  "process",
  "other",
  "",
]);

/** Two tiers exactly: featured first (newest featured first), then votes desc, newest breaking ties. */
export function sortEntries<
  T extends Pick<Comment, "featured" | "featuredAt" | "votes" | "createdAt">,
>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    (a.featured ? 0 : 1) - (b.featured ? 0 : 1) ||
    (a.featured && b.featured ? b.featuredAt - a.featuredAt : 0) ||
    b.votes - a.votes || b.createdAt - a.createdAt
  );
}

export function commentRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;
  const rolesFor = (address: string, rfpId: string, isAdmin: boolean) =>
    commentRoles(deps, address, rfpId).then((roles) =>
      isAdmin && !roles.includes("ADMIN") ? ["ADMIN", ...roles] : roles
    );

  r.get("/initiatives/:slug/comments", async (c) => {
    if (!(await db.rateLimit("cml:" + c.var.ip, 60, 60))) {
      throw new HttpError(429, "slow down");
    }
    const rfp = await db.rfps.bySlug(c.req.param("slug"));
    if (!rfp || !["approved", "archived"].includes(rfp.status)) {
      throw new HttpError(404, "not found");
    }
    const rows = await db.comments.forRfp(rfp.id);
    const user = c.var.user;
    let myVotes: Record<string, number> = {};
    let eligible = false;
    let viewerRoles: string[] = [];
    if (user) {
      myVotes = await db.comments.votesByAddress(rfp.id, user.address);
      eligible = user.isAdmin || await voteEligible(deps, user.address, rfp.id);
      viewerRoles = await rolesFor(user.address, rfp.id, user.isAdmin);
    }
    const admins = await deps.admins.set();
    const live = (row: Comment) => liveRoles(admins, row.address, rfp);
    const replies = new Map<string, CommentJson[]>();
    const entries: Comment[] = [];
    for (const row of rows) {
      if (row.parentId) {
        const list = replies.get(row.parentId) ?? [];
        list.push(commentJson(row, live(row)));
        replies.set(row.parentId, list);
      } else entries.push(row);
    }
    return c.json({
      entries: sortEntries(entries).map((e) =>
        commentJson(e, live(e), myVotes, replies.get(e.id) ?? [])
      ),
      viewerCanVote: eligible,
      viewerRoles,
    });
  });

  r.post("/initiatives/:slug/comments", async (c) => {
    const rfp = await db.rfps.bySlug(c.req.param("slug"));
    const body = await jsonBody(c);
    if (!rfp) throw new HttpError(404, "not found");
    await assertInitiativeIdentity(db, c.req.param("slug"), rfp, body.initiativeId);
    if (rfp.status !== "approved") throw new HttpError(404, "not found");
    // honeypot: accept and discard silently
    if (s(body.website)) return c.json({ status: "published", id: "", claimToken: "" });
    const ctype = s(body.type, 20) as CommentType;
    const topic = s(body.topic, 20);
    const text = s(body.body, COMMENT_BODY_MAX + 1);
    const name = s(body.name, 60);
    const email = s(body.email, 200);
    if (!COMMENT_TYPES.has(ctype) || !COMMENT_TOPICS.has(topic)) {
      throw new HttpError(400, "bad type or topic");
    }
    if (!text || text.length > COMMENT_BODY_MAX) {
      throw new HttpError(400, `the text must be 1 to ${COMMENT_BODY_MAX} characters`);
    }
    if (email && !EMAIL_RE.test(email)) {
      throw new HttpError(400, "that email does not look right");
    }
    const user = c.var.user;
    const address = user?.address ?? "";
    if (!address && !name) {
      throw new HttpError(400, "a name is required without a wallet");
    }
    await assertEthNameOwned(deps.ens, name, address);
    const who = user ? "addr:" + user.address.toLowerCase() : "ip:" + c.var.ip;
    if (!(await db.rateLimit("cpost:" + who, 5, 3600))) {
      throw new HttpError(429, "too many posts from your address, try again in an hour");
    }
    if (!user && !(await db.rateLimit("cpostanon:" + c.var.ip, 3, 3600))) {
      throw new HttpError(429, "too many posts from your address, try again in an hour");
    }
    const roles = await rolesFor(address, rfp.id, Boolean(user?.isAdmin));
    let status: "published" | "held" | "discarded";
    let summary: string;
    if (roles.some((x) => ROLE_FAST_LANE.has(x))) {
      [status, summary] = ["published", "role fast-lane"];
    } else {[status, summary] = await deps.ai.screenComment(
        ctype,
        topic,
        text,
        name,
        () => db.meta.aiBudgetOk(),
      );}
    if (status === "discarded") {
      deps.log(`comment discarded by AI screen (rfp ${rfp.id}): ${summary}`);
      // The author sees the same "waiting" note as held; a spammer learns nothing.
      return c.json({ status: "held", id: "", claimToken: "" });
    }
    const startVote = Boolean(user?.isAdmin) || await voteEligible(deps, address, rfp.id);
    const cm = await db.comments.create({
      rfpId: rfp.id,
      parentId: null,
      type: ctype,
      topic,
      body: text,
      displayName: name,
      email,
      address,
      roles: storedRoles(roles),
      status,
      aiSummary: summary,
    }, startVote);
    return c.json({
      status,
      id: cm.id,
      claimToken: status === "held" ? cm.claimToken : "",
      entry: status === "published"
        ? commentJson(
          cm,
          liveRoles(await deps.admins.set(), address, rfp),
          startVote ? { [cm.id]: 1 } : {},
          [],
        )
        : null,
    });
  });

  r.get("/comments/mine", async (c) => {
    if (!(await db.rateLimit("cmine:" + c.var.ip, 30, 60))) {
      throw new HttpError(429, "slow down");
    }
    const tokens = (c.req.query("tokens") ?? "").split(",").filter((t) => /^[0-9a-f]{32}$/.test(t))
      .slice(0, 20);
    const rows = await db.comments.byClaimTokens(tokens);
    return c.json({
      held: rows.map((x) => ({
        id: x.id,
        rfpId: x.rfpId,
        parentId: x.parentId,
        type: x.type,
        body: x.body,
        createdAt: x.createdAt,
      })),
    });
  });

  r.post("/comments/:id/vote", requireAuth, async (c) => {
    const user = c.var.user!;
    if (!(await db.rateLimit("cvote:" + user.address.toLowerCase(), 30, 3600))) {
      throw new HttpError(429, "too many votes, slow down");
    }
    const row = await db.comments.get(c.req.param("id"));
    if (!row || row.status !== "published" || row.parentId) {
      throw new HttpError(404, "not found");
    }
    const body = await jsonBody(c);
    const dir = s(body.dir, 10) || "up";
    if (dir !== "up" && dir !== "down") throw new HttpError(400, "bad vote direction");
    if (!user.isAdmin && !(await voteEligible(deps, user.address, row.rfpId))) {
      throw new HttpError(
        403,
        "Voting is for donors of $20+ to this initiative, ETHSecurity badge holders, curators, and admins.",
      );
    }
    const res = await db.comments.setVote(row.id, user.address, dir === "up" ? 1 : -1);
    return c.json({ myvote: res!.myvote, votes: res!.score });
  });

  r.post("/comments/:id/report", async (c) => {
    if (!(await db.rateLimit("crep:" + c.var.ip, 10, 86400))) {
      throw new HttpError(429, "too many reports today");
    }
    const row = await db.comments.get(c.req.param("id"));
    if (!row || row.status !== "published") throw new HttpError(404, "not found");
    await db.comments.addReport(row.id);
    return c.json({ ok: true });
  });

  /** Anyone can reply. Team, proposer, curator and badge-holder replies are
   * published at once and answer a question; other replies (signed in or
   * with just a name) go through the same screening as top-level posts and
   * may be held, with a private claim token so the author can see them. */
  r.post("/comments/:id/reply", async (c) => {
    const user = c.var.user;
    const parent = await db.comments.get(c.req.param("id"));
    if (!parent || parent.status !== "published" || parent.parentId) {
      throw new HttpError(404, "not found");
    }
    const body = await jsonBody(c);
    const text = s(body.body, COMMENT_BODY_MAX + 1);
    if (!text || text.length > COMMENT_BODY_MAX) {
      throw new HttpError(400, `the text must be 1 to ${COMMENT_BODY_MAX} characters`);
    }
    const name = s(body.name, 60);
    const address = user?.address ?? "";
    if (!address && !name) {
      throw new HttpError(400, "a name is required without a wallet");
    }
    await assertEthNameOwned(deps.ens, name, address);
    const who = user ? "addr:" + user.address.toLowerCase() : "ip:" + c.var.ip;
    if (!(await db.rateLimit("creply:" + who, 20, 3600))) {
      throw new HttpError(429, "too many replies, slow down");
    }
    if (!user && !(await db.rateLimit("creplyanon:" + c.var.ip, 3, 3600))) {
      throw new HttpError(429, "too many replies from your address, try again in an hour");
    }
    const roles = user ? await rolesFor(user.address, parent.rfpId, user.isAdmin) : [];
    const fastLane = roles.some((x) => ROLE_FAST_LANE.has(x));
    let status: "published" | "held" | "discarded" = "published";
    let summary = "role fast-lane";
    if (!fastLane) {
      [status, summary] = await deps.ai.screenComment(
        parent.type,
        parent.topic,
        text,
        name,
        () => db.meta.aiBudgetOk(),
      );
    }
    if (status === "discarded") {
      deps.log(`reply discarded by AI screen (comment ${parent.id}): ${summary}`);
      // Same answer as held: a spammer learns nothing.
      return c.json({
        ok: true,
        status: "held",
        reply: null,
        claimToken: "",
        answered: parent.answered,
      });
    }
    const reply = await db.comments.create({
      rfpId: parent.rfpId,
      parentId: parent.id,
      type: parent.type,
      topic: "",
      body: text,
      displayName: name,
      email: "",
      address,
      roles: storedRoles(roles),
      status,
      aiSummary: summary,
    });
    let answered = parent.answered;
    if (fastLane && parent.type === "question" && !parent.answered) {
      await db.comments.set(parent.id, { answered: true });
      answered = true;
    }
    return c.json({
      ok: true,
      status,
      reply: status === "published"
        ? commentJson(
          reply,
          liveRoles(await deps.admins.set(), address, await db.rfps.get(parent.rfpId)),
        )
        : null,
      claimToken: status === "held" ? reply.claimToken : "",
      answered,
    });
  });

  return r;
}
