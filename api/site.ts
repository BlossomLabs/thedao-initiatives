/** Static files and SPA fallback, served as the last route in the Hono app. */
import { serveDir } from "@std/http/file-server";
import { collectScriptHashes, type SitePolicy, sitePolicy } from "./lib/site-headers.ts";

export interface SiteOptions {
  root: string;
  siteUrl: string;
}

export interface StaticSite {
  policy: SitePolicy;
  serve(req: Request): Promise<Response>;
}

export async function createStaticSite(
  { root, siteUrl }: SiteOptions,
  cspEnforce: boolean,
  log: (message: string) => void = () => {},
): Promise<StaticSite> {
  // Hash the prerendered inline scripts once, before accepting requests.
  const scriptHashes = await collectScriptHashes(root);
  const policy = sitePolicy({ cspEnforce, scriptHashes });
  log(
    `site headers: CSP ${cspEnforce ? "enforced" : "report-only"}, ` +
      `${scriptHashes.length} inline script hash(es)`,
  );

  /** Prerendered pages bake the site URL into their meta; rewrite for staging origins. */
  async function rewriteOrigin(res: Response, origin: string): Promise<Response> {
    if (origin === siteUrl || res.status !== 200) return res;
    if (!res.headers.get("Content-Type")?.includes("text/html")) return res;
    const html = (await res.text()).replaceAll(siteUrl, origin);
    const headers = new Headers(res.headers);
    headers.delete("Content-Length");
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

  return { policy, serve };
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
