/**
 * GET /initiative/<slug>.md: the published initiative as a markdown file, in
 * the same shape as content/rfps/*.md. Public rows only (approved, archived).
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { initiativeMarkdown } from "../services/markdown.ts";

export const isInitiativeMarkdown = (path: string) => /^\/initiative\/[a-z0-9-]+\.md$/.test(path);

export function markdownRoutes({ db }: Deps) {
  const r = new Hono<Vars>();
  r.get("/:file{[a-z0-9-]+\\.md}", async (c) => {
    const slug = c.req.param("file").slice(0, -3);
    const rfp = await db.rfps.bySlug(slug);
    if (!rfp || !["approved", "archived"].includes(rfp.status)) {
      throw new HttpError(404, "not found");
    }
    const md = initiativeMarkdown(rfp, await db.pledges.list(rfp.id));
    return c.body(md, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}.md"`,
      "Cache-Control": "public, max-age=60",
    });
  });
  return r;
}
