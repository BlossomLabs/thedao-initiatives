import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  collectScriptHashes,
  fullCsp,
  inlineScripts,
  MINIMAL_CSP,
  scriptHash,
  scriptHashes,
  sitePolicy,
} from "../lib/site-headers.ts";
import { Hono } from "hono";
import { securityHeaders } from "../middleware/headers.ts";
import type { SitePolicy } from "../lib/site-headers.ts";
import { loadConfig } from "../config.ts";

async function withHeaders(response: Response, policy: SitePolicy): Promise<Response> {
  const app = new Hono();
  app.use("*", securityHeaders(policy));
  app.get("/", () => response);
  return await app.request("/");
}

const FIXTURE = `<!DOCTYPE html><html><head>
<script>setTimeout(function(){document.body.style.visibility='visible'},4000);</script>
<script src="/assets/entry.client-abc123.js" type="module"></script>
<script type="module" async>window.__reactRouterContext = {"url":"/"};</script>
<script
  src="/assets/other.js"></script>
</head><body>
<script>setTimeout(function(){document.body.style.visibility='visible'},4000);</script>
</body></html>`;

Deno.test("site headers: every header is present and Cache-Control survives", async () => {
  const cached = new Response("<html></html>", {
    status: 200,
    headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
  });
  const res = await withHeaders(cached, sitePolicy({ cspEnforce: false }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "no-cache");
  assertEquals(res.headers.get("Content-Type"), "text/html");
  assertEquals(
    res.headers.get("Strict-Transport-Security"),
    "max-age=63072000; includeSubDomains; preload",
  );
  assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(res.headers.get("X-Frame-Options"), "DENY");
  assertEquals(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assertEquals(res.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
  assert(res.headers.has("Content-Security-Policy"));
  assert(res.headers.has("Content-Security-Policy-Report-Only"));
  // Fallbacks and 404s get the same treatment.
  const notFound = await withHeaders(
    new Response("nope", { status: 404 }),
    sitePolicy({
      cspEnforce: false,
    }),
  );
  assertEquals(notFound.status, 404);
  assertEquals(notFound.headers.get("X-Frame-Options"), "DENY");
});

Deno.test("site headers: report-only by default, full policy enforced with CSP_ENFORCE", async () => {
  const hashes = ["'sha256-AAAA'"];
  const reporting = await withHeaders(
    new Response(""),
    sitePolicy({
      cspEnforce: false,
      scriptHashes: hashes,
    }),
  );
  assertEquals(reporting.headers.get("Content-Security-Policy"), MINIMAL_CSP);
  assertEquals(reporting.headers.get("Content-Security-Policy-Report-Only"), fullCsp(hashes));

  const enforcing = await withHeaders(
    new Response(""),
    sitePolicy({
      cspEnforce: true,
      scriptHashes: hashes,
    }),
  );
  assertEquals(enforcing.headers.get("Content-Security-Policy"), fullCsp(hashes));
  assertEquals(enforcing.headers.get("Content-Security-Policy-Report-Only"), null);

  const full = fullCsp(hashes);
  assertStringIncludes(full, "script-src 'self' 'sha256-AAAA'");
  assertStringIncludes(full, "frame-ancestors 'none'");
  assertStringIncludes(full, "base-uri 'self'");
  assertStringIncludes(full, "form-action 'self'");
  assertStringIncludes(full, "object-src 'none'");
  assertStringIncludes(full, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  assertStringIncludes(full, "connect-src 'self' https: wss:");
  assertStringIncludes(MINIMAL_CSP, "frame-ancestors 'none'");
  assert(!MINIMAL_CSP.includes("script-src"));
});

Deno.test("config: CSP_ENFORCE flag", () => {
  assertEquals(loadConfig({}).cspEnforce, false);
  assertEquals(loadConfig({ CSP_ENFORCE: "true" }).cspEnforce, true);
  assertEquals(loadConfig({ CSP_ENFORCE: "1" }).cspEnforce, true);
  assertEquals(loadConfig({ CSP_ENFORCE: "false" }).cspEnforce, false);
});

Deno.test("inline scripts: extracted without src, ignored with src", () => {
  const scripts = inlineScripts(FIXTURE);
  assertEquals(scripts.length, 3);
  assertEquals(
    scripts[0],
    "setTimeout(function(){document.body.style.visibility='visible'},4000);",
  );
  assertEquals(scripts[1], 'window.__reactRouterContext = {"url":"/"};');
  assertEquals(scripts[2], scripts[0]);
  assertEquals(inlineScripts("<p>no scripts</p>"), []);
});

Deno.test("script hashes: 'sha256-<base64>' tokens, deduplicated across documents", async () => {
  // Known vector: SHA-256("") = 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=
  assertEquals(await scriptHash(""), "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  const hashes = await scriptHashes([FIXTURE, FIXTURE]);
  assertEquals(hashes.length, 2);
  for (const h of hashes) assertMatch(h, /^'sha256-[A-Za-z0-9+/]+=*'$/);
  assertEquals(hashes[0], await scriptHash(inlineScripts(FIXTURE)[0]));
  assertEquals(await scriptHashes([]), []);
});

Deno.test("collectScriptHashes: walks a directory of HTML; missing directory yields none", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/initiative`);
    await Deno.writeTextFile(`${dir}/index.html`, FIXTURE);
    await Deno.writeTextFile(`${dir}/initiative/x.html`, "<script>alert(1)</script>");
    await Deno.writeTextFile(`${dir}/assets.js`, "<script>not html</script>");
    const hashes = await collectScriptHashes(dir);
    assertEquals(hashes.length, 3);
    assert(hashes.includes(await scriptHash("alert(1)")));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
  assertEquals(await collectScriptHashes(`${dir}/does-not-exist`), []);
});
