/**
 * GET /initiative/<slug>.md: the published initiative as a markdown file, in
 * the same shape as content/rfps/*.md. Public rows only (approved, archived).
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { initiativeMarkdown } from "../services/markdown.ts";

export const MARKDOWN_PATHS = {
  public: "/:file{[a-z0-9-]+\\.md}",
  private: "/:file{[a-z0-9-]+-PRIVATE\\.md}",
} as const;

export function markdownRoutes({ db }: Deps) {
  const r = new Hono<Vars>();
  /** <slug>-PRIVATE.md: admins only; any status, plus contact and funders. */
  r.get(MARKDOWN_PATHS.private, requireAdmin, async (c) => {
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
    const md = initiativeMarkdown(initiative, await db.pledges.list(initiative.id));
    return c.body(md, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}.md"`,
      "Cache-Control": "public, max-age=60",
    });
  });
  return r;
}
