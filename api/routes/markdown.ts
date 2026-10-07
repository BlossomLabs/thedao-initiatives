/**
 * GET /initiative/<slug>.md: the published initiative as a markdown file, in
 * the same shape as content/initiatives/*.md (so it syncs back in), plus the
 * funding facts agents need (url, categories, raised, backers, Safe) as extra
 * front matter the sync ignores. Public rows only (approved, archived).
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireAdmin, requireRecentAuth } from "../middleware/auth.ts";
import { initiativeMarkdown } from "../services/markdown.ts";
import { feedFrontMatter } from "../services/feed.ts";
import { type FeedCache, feedResponse } from "./feeds.ts";

export const MARKDOWN_PATHS = {
  public: "/:file{[a-z0-9-]+\\.md}",
  private: "/:file{[a-z0-9-]+-PRIVATE\\.md}",
} as const;

export function markdownRoutes({ db, now }: Deps, feeds?: FeedCache) {
  const r = new Hono<Vars>();
  /** <slug>-PRIVATE.md: admins only; any status, plus contact and funders. */
  r.get(MARKDOWN_PATHS.private, requireAdmin, requireRecentAuth(now), async (c) => {
    const slug = c.req.param("file").slice(0, -"-PRIVATE.md".length);
    const initiative = await db.initiatives.bySlug(slug);
    if (!initiative) throw new HttpError(404, "not found");
    const md = initiativeMarkdown(initiative, await db.pledges.list(initiative.id, true), {
      privateFields: true,
    });
    return c.body(md, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-PRIVATE.md"`,
      "Cache-Control": "no-store",
    });
  });
  r.get(MARKDOWN_PATHS.public, async (c) => {
    const slug = c.req.param("file").slice(0, -3);
    const initiative = await db.initiatives.bySlug(slug);
    if (!initiative || !["approved", "archived"].includes(initiative.status)) {
      throw new HttpError(404, "not found");
    }
    const entry = initiative.status === "approved" && feeds
      ? (await feeds.get(feeds.origin(c))).initiatives.find((x) => x.slug === slug)
      : undefined;
    const md = initiativeMarkdown(initiative, await db.pledges.list(initiative.id), {
      extraFrontMatter: entry ? feedFrontMatter(entry) : [],
    });
    const res = await feedResponse(c, md, "text/markdown; charset=utf-8");
    res.headers.set("Content-Disposition", `inline; filename="${slug}.md"`);
    return res;
  });
  return r;
}
