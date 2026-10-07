/** Static files and SPA fallback, served as the last route in the Hono app. */
import { serveDir } from "@std/http/file-server";
import {
  collectScriptHashes,
  scriptHashes as hashScripts,
  type SitePolicy,
  sitePolicy,
} from "./lib/site-headers.ts";

export interface SiteOptions {
  root: string;
  siteUrl: string;
  connectOrigins?: string[];
  /** Exact browser origins and trusted edge-host suffixes from server configuration. */
  rewriteOrigins?: string[];
  selfHostSuffixes?: string[];
}

export interface StaticSite {
  policy: SitePolicy;
  /** The served build's id (React Router's manifest version); null without a build. */
  version: string | null;
  serve(req: Request): Promise<Response>;
}

export async function createStaticSite(
  { root, siteUrl, connectOrigins, rewriteOrigins = [], selfHostSuffixes = [] }: SiteOptions,
  cspEnforce: boolean,
  log: (message: string) => void = () => {},
): Promise<StaticSite> {
  // Hash the prerendered inline scripts once, before accepting requests.
  const scriptHashes = await collectScriptHashes(root);
  const policy = sitePolicy({ cspEnforce, scriptHashes, connectOrigins });
  const allowedOrigins = new Set(rewriteOrigins);
  const trustedSuffixes = selfHostSuffixes.filter((suffix) => /^\.[a-z0-9.-]+$/.test(suffix));
  log(
    `site headers: CSP ${cspEnforce ? "enforced" : "report-only"}, ` +
      `${scriptHashes.length} inline script hash(es)`,
  );

  const version = await buildVersion(root);
  if (version) log(`site build version: ${version}`);

  /** Prerendered pages bake the site URL into their meta; rewrite for staging origins. */
  async function rewriteOrigin(res: Response, origin: string): Promise<Response> {
    if (origin === siteUrl || res.status !== 200) return res;
    const url = new URL(origin);
    const trustedEdge = url.protocol === "https:" && !url.port &&
      trustedSuffixes.some((suffix) => url.hostname.endsWith(suffix));
    if (!allowedOrigins.has(origin) && !trustedEdge) return res;
    if (!res.headers.get("Content-Type")?.includes("text/html")) return res;
    const html = (await res.text()).replaceAll(siteUrl, origin);
    const headers = new Headers(res.headers);
    headers.delete("Content-Length");
    headers.delete("ETag");
    // Origin rewriting can change inline hydration scripts. Hash the bytes actually served.
    const rewritten = sitePolicy({
      cspEnforce,
      scriptHashes: await hashScripts([html]),
      connectOrigins,
    });
    headers.set("Content-Security-Policy", rewritten.enforced);
    if (rewritten.reportOnly) {
      headers.set("Content-Security-Policy-Report-Only", rewritten.reportOnly);
    }
    return new Response(html, { status: res.status, headers });
  }

  async function serve(req: Request): Promise<Response> {
    const { origin, pathname } = new URL(req.url);
    const res = await serveDir(req, { fsRoot: root, quiet: true });
    if (res.status !== 404) return withCaching(await rewriteOrigin(res, origin), pathname);
    for (const fallback of ["/__spa-fallback.html", "/index.html"]) {
      const fb = await serveDir(new Request(new URL(fallback, req.url), req), {
        fsRoot: root,
        quiet: true,
      });
      if (fb.status === 200) return withCaching(await rewriteOrigin(fb, origin), pathname);
    }
    return res;
  }

  return { policy, version, serve };
}

/**
 * Every page loads `/assets/manifest-<version>.js`, and the app reads the same
 * version from that file (`__reactRouterManifest.version`), so the two sides
 * agree without a build step of their own. It changes whenever any script or
 * stylesheet of the build does.
 */
async function buildVersion(root: string): Promise<string | null> {
  for (const page of ["index.html", "__spa-fallback.html"]) {
    try {
      const html = await Deno.readTextFile(`${root}/${page}`);
      const version = html.match(/\/assets\/manifest-([A-Za-z0-9_-]+)\.js/)?.[1];
      if (version) return version;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return null;
}

/** Vite's hashed assets are immutable; HTML must be revalidated after each deploy. */
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
