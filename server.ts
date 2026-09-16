/// <reference lib="deno.ns" />
/**
 * Site server (Deno Deploy entrypoint): the API under /api and /healthz, the
 * built SPA from build/client for everything else, with the prerendered
 * shell as fallback for client-side routes such as /initiative/<slug>. The
 * private-preview lock (SITE_USERNAME/SITE_PASSWORD) covers both.
 */
import { serveDir } from "@std/http/file-server";
import { createServer } from "./api/bootstrap.ts";
import { LOCK_MESSAGE, LOCK_REALM } from "./api/lib/sitelock.ts";
import { collectScriptHashes, sitePolicy, withSiteHeaders } from "./api/lib/site-headers.ts";
import { isInitiativeMarkdown } from "./api/routes/markdown.ts";
import { refreshDailyCache } from "./api/services/daily-cache.ts";

const { app, lock, config, deps } = await createServer();
// Register at module scope so Deploy discovers the job. The handler checks
// DENO_TIMELINE before doing any work; branch timelines immediately return.
Deno.cron("refresh-public-cache-daily", "0 3 * * *", async () => {
  await refreshDailyCache(deps, Deno.env.get("DENO_TIMELINE"));
});
// Mirrors app/data/site.ts (which is Vite-only code).
const SITE_URL = (Deno.env.get("VITE_SITE_URL") ?? "").replace(/\/+$/, "") ||
  "https://fund.thedao.fund";
const ROOT = new URL("./build/client", import.meta.url).pathname;

// The prerendered pages carry inline scripts (root.tsx's shell script and
// React Router's hydration data); their hashes go into script-src so the CSP
// can allow exactly those and nothing else. Computed once, at startup.
const scriptHashes = await collectScriptHashes(ROOT);
const policy = sitePolicy({ cspEnforce: config.cspEnforce, scriptHashes });
console.log(
  `site headers: CSP ${config.cspEnforce ? "enforced" : "report-only"}, ` +
    `${scriptHashes.length} inline script hash(es)`,
);

const isApi = (path: string) =>
  path === "/healthz" || path === "/api" || path.startsWith("/api/") || isInitiativeMarkdown(path);

/** Prerendered pages bake SITE_URL into their meta; rewrite for staging origins. */
async function rewriteOrigin(res: Response, origin: string): Promise<Response> {
  if (origin === SITE_URL || res.status !== 200) return res;
  if (!res.headers.get("Content-Type")?.includes("text/html")) return res;
  const html = (await res.text()).replaceAll(SITE_URL, origin);
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  return new Response(html, { status: res.status, headers });
}

/**
 * Vite names every asset by content hash, so those can be cached for good;
 * the HTML shell must be revalidated on every load (the ETag makes that a
 * cheap 304) or a browser keeps running the previous deploy's bundle.
 */
function withCaching(res: Response, path: string): Response {
  if (res.status !== 200) return res;
  const html = res.headers.get("Content-Type")?.includes("text/html");
  const value = path.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : html
    ? "no-cache"
    : "public, max-age=300";
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function serveStatic(req: Request): Promise<Response> {
  const { origin, pathname } = new URL(req.url);
  const res = await serveDir(req, { fsRoot: ROOT, quiet: true });
  if (res.status !== 404) return withCaching(await rewriteOrigin(res, origin), pathname);
  for (const fallback of ["/__spa-fallback.html", "/index.html"]) {
    const fb = await serveDir(new Request(new URL(fallback, req.url), req), {
      fsRoot: ROOT,
      quiet: true,
    });
    if (fb.status === 200) return withCaching(await rewriteOrigin(fb, origin), pathname);
  }
  return res;
}

function withHeader(res: Response, name: string, value: string): Response {
  const headers = new Headers(res.headers);
  headers.append(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

Deno.serve({ port: config.port }, async (req) => {
  if (isApi(new URL(req.url).pathname)) return app.fetch(req);
  const verdict = await lock.check(req);
  if (verdict === "denied") {
    return new Response(LOCK_MESSAGE, {
      status: 401,
      headers: { "WWW-Authenticate": LOCK_REALM, "Cache-Control": "no-store" },
    });
  }
  const res = withSiteHeaders(await serveStatic(req), policy);
  return verdict === "basic" ? withHeader(res, "Set-Cookie", await lock.cookie()) : res;
});
