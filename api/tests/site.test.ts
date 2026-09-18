/** Exercise the deployed Hono app with real static files and the in-memory API. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../app.ts";
import { createStaticSite } from "../site.ts";
import { MINIMAL_CSP, scriptHash } from "../lib/site-headers.ts";
import { LOCK_COOKIE } from "../lib/sitelock.ts";
import { SECURE_SESSION_COOKIE } from "../lib/session-cookie.ts";
import { ADMIN, harness, ORIGIN, PLAIN, testConnection } from "./app-helpers.ts";

const SITE_URL = "https://initiatives.thedao.fund";
const PREVIEW = "https://preview.test";
const SCRIPT = "window.ready = true;";
const BASIC = "Basic " + btoa("preview:secret");
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

async function siteHarness(env: Record<string, string> = {}) {
  const h = await harness({ env: { CSP_ENFORCE: "false", ...env } });
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/assets`);
  await Deno.mkdir(`${root}/admin`);
  await Deno.writeTextFile(
    `${root}/index.html`,
    `<html><link rel="canonical" href="${SITE_URL}/"><script>${SCRIPT}</script>HOME</html>`,
  );
  await Deno.writeTextFile(`${root}/__spa-fallback.html`, "<html>SPA FALLBACK</html>");
  await Deno.writeTextFile(`${root}/admin/index.html`, "<html>ADMIN PAGE</html>");
  await Deno.writeTextFile(`${root}/assets/app-abc123.js`, SCRIPT);
  await Deno.writeTextFile(`${root}/robots.txt`, "User-agent: *");
  const site = await createStaticSite({
    root,
    siteUrl: SITE_URL,
    rewriteOrigins: [PREVIEW],
    selfHostSuffixes: [".deno.net"],
  }, h.deps.config.cspEnforce);
  const app = createApp(h.deps, undefined, site);
  return {
    ...h,
    app,
    root,
    site,
    req(path: string, init?: RequestInit, ip = "203.0.113.42") {
      return app.request(PREVIEW + path, init, testConnection(ip));
    },
    async close() {
      h.close();
      await Deno.remove(root, { recursive: true });
    },
  };
}

function sharedHeaders(res: Response) {
  assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(res.headers.get("X-Frame-Options"), "DENY");
  assertEquals(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assertEquals(res.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
  assertEquals(
    res.headers.get("Strict-Transport-Security"),
    "max-age=63072000; includeSubDomains; preload",
  );
}

Deno.test("site: only approved origins rewrite HTML, including hydration hashes", async () => {
  const h = await siteHarness({ CSP_ENFORCE: "true" });
  try {
    await Deno.writeTextFile(
      `${h.root}/index.html`,
      `<link rel="canonical" href="${SITE_URL}/"><script>window.site='${SITE_URL}'</script>`,
    );
    for (const origin of [PREVIEW, "https://branch-project.deno.net"]) {
      const res = await h.app.request(origin + "/");
      assertStringIncludes(await res.text(), `href="${origin}/"`);
      assertStringIncludes(
        res.headers.get("Content-Security-Policy")!,
        await scriptHash(`window.site='${origin}'`),
      );
    }
    for (
      const origin of [
        "https://attacker.test",
        "https://preview.test.attacker.test",
        "https://evil-deno.net",
        "https://branch.deno.net.evil.test",
        "http://branch.deno.net",
        "https://branch.deno.net:444",
        "https://preview.test:444",
      ]
    ) {
      const res = await h.app.request(origin + "/", {
        headers: { "X-Forwarded-Host": "preview.test" },
      });
      const html = await res.text();
      assertStringIncludes(html, `href="${SITE_URL}/"`);
      assert(!html.includes(origin), origin);
    }
  } finally {
    await h.close();
  }
});

Deno.test("site: Hono serves pages, assets and SPA fallbacks without swallowing API routes", async () => {
  const h = await siteHarness();
  try {
    const home = await h.req("/");
    assertEquals(home.status, 200);
    sharedHeaders(home);
    assertEquals(home.headers.get("Cache-Control"), "no-cache");
    assertEquals(home.headers.get("Content-Security-Policy"), MINIMAL_CSP);
    assertStringIncludes(
      home.headers.get("Content-Security-Policy-Report-Only")!,
      await scriptHash(SCRIPT),
    );
    const html = await home.text();
    assertStringIncludes(html, `href="${PREVIEW}/"`);
    assertStringIncludes(html, `<script>${SCRIPT}</script>`);
    for (
      const [path, body] of [
        ["/admin/", "<html>ADMIN PAGE</html>"],
        ["/initiative/example", "<html>SPA FALLBACK</html>"],
        ["/apiculture", "<html>SPA FALLBACK</html>"],
      ]
    ) {
      const res = await h.req(path);
      assertEquals(res.status, 200, path);
      assertEquals(res.headers.get("Cache-Control"), "no-cache");
      assertEquals(await res.text(), body);
    }
    const asset = await h.req("/assets/app-abc123.js");
    assertEquals(asset.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assertEquals(await asset.text(), SCRIPT);
    const robots = await h.req("/robots.txt");
    assertEquals(robots.headers.get("Cache-Control"), "public, max-age=300");
    assertEquals(await robots.text(), "User-agent: *");

    for (const path of ["/healthz", "/api/board"]) {
      const res = await h.req(path);
      assertEquals(res.status, 200, path);
      sharedHeaders(res);
      assertEquals(res.headers.get("Content-Security-Policy"), API_CSP);
      assertEquals(res.headers.get("Content-Security-Policy-Report-Only"), null);
      await res.json();
    }
    for (const path of ["/api", "/api/", "/api/nope", "/initiative/nope.md"]) {
      const res = await h.req(path);
      assertEquals(res.status, 404, path);
      assertEquals(res.headers.get("Content-Security-Policy"), API_CSP);
      assertEquals(await res.json(), { error: "not found" });
    }
    const wrongMethod = await h.req("/healthz", { method: "POST" });
    assertEquals(wrongMethod.status, 404);
    assertEquals(await wrongMethod.json(), { error: "not found" });
  } finally {
    await h.close();
  }
});

Deno.test("site: static requests skip API sessions, auditing and CORS; API guards still run", async () => {
  const h = await siteHarness();
  try {
    const token = await h.mint(ADMIN, true);
    const get = h.db.sessions.get;
    let sessionReads = 0;
    h.db.sessions.get = (...args) => {
      sessionReads++;
      return get(...args);
    };
    const logs: string[] = [];
    h.deps.log = (message) => logs.push(message);
    const headers = { Cookie: `${SECURE_SESSION_COOKIE}=${token}`, Origin: ORIGIN };
    for (const path of ["/", "/assets/app-abc123.js", "/initiative/example"]) {
      const res = await h.req(path, { headers });
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(res.headers.get("X-Request-ID"), null);
      await res.text();
    }
    assertEquals(sessionReads, 0);
    assertEquals(logs, []);
    const me = await h.req("/api/auth/me", { headers });
    assertEquals(me.status, 200);
    assertEquals((await me.json()).address, ADMIN);
    assertEquals(sessionReads, 1);
    assertEquals(me.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert(me.headers.has("X-Request-ID"));

    const denied = await h.req("/api/auth/logout", {
      method: "POST",
      headers: { ...headers, Origin: "https://unrelated.invalid" },
    });
    assertEquals(denied.status, 403);
    assertEquals(denied.headers.get("Content-Security-Policy"), API_CSP);
    assertEquals(sessionReads, 1);
    const preflight = await h.req("/api/auth/logout", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assertEquals(preflight.headers.get("Content-Security-Policy"), API_CSP);
    assertEquals(sessionReads, 1);
  } finally {
    await h.close();
  }
});

Deno.test("site: the shared preview gate covers all routes and preserves session cookies", async () => {
  const h = await siteHarness({ SITE_USERNAME: "preview", SITE_PASSWORD: "secret" });
  try {
    for (const path of ["/", "/assets/app-abc123.js", "/api/board"]) {
      const res = await h.req(path);
      assertEquals(res.status, 401);
      sharedHeaders(res);
      assert(res.headers.has("WWW-Authenticate"));
      assertEquals(res.headers.get("Cache-Control"), "no-store");
      assertEquals(
        res.headers.get("Content-Security-Policy"),
        path.startsWith("/api/") ? API_CSP : MINIMAL_CSP,
      );
    }
    assertEquals((await h.req("/healthz")).status, 200);
    assertEquals((await h.req("/api/board", { method: "OPTIONS" })).status, 204);
    const unlocked = await h.req("/", { headers: { Authorization: BASIC } });
    assertEquals(unlocked.status, 200);
    await unlocked.text();
    const cookies = unlocked.headers.getSetCookie();
    assertEquals(cookies.length, 1);
    assertStringIncludes(cookies[0], `${LOCK_COOKIE}=`);
    const cookie = cookies[0].split(";")[0];
    for (const path of ["/assets/app-abc123.js", "/api/board"]) {
      const res = await h.req(path, { headers: { Cookie: cookie } });
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("Set-Cookie"), null);
      await res.text();
    }
    const token = await h.mint(ADMIN, true);
    const logout = await h.req("/api/auth/logout", {
      method: "POST",
      headers: {
        Authorization: BASIC,
        Cookie: `${SECURE_SESSION_COOKIE}=${token}`,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assertEquals(logout.status, 200);
    const logoutCookies = logout.headers.getSetCookie();
    assertEquals(logoutCookies.length, 2);
    assert(logoutCookies.some((c) => c.startsWith(`${SECURE_SESSION_COOKIE}=;`)));
    assert(logoutCookies.some((c) => c.startsWith(`${LOCK_COOKIE}=`)));
  } finally {
    await h.close();
  }
});

Deno.test("site: enforced CSP and shared headers cover static 404s and unexpected errors", async () => {
  const h = await siteHarness({ CSP_ENFORCE: "true" });
  try {
    const home = await h.req("/");
    const policy = home.headers.get("Content-Security-Policy");
    assertStringIncludes(policy!, await scriptHash(SCRIPT));
    assertEquals(home.headers.get("Content-Security-Policy-Report-Only"), null);
    await home.text();
    await Deno.remove(`${h.root}/__spa-fallback.html`);
    const fallback = await h.req("/initiative/example");
    assertEquals(fallback.status, 200);
    assertStringIncludes(await fallback.text(), "HOME");
    await Deno.remove(`${h.root}/index.html`);
    const missing = await h.req("/missing");
    assertEquals(missing.status, 404);
    sharedHeaders(missing);
    assertEquals(missing.headers.get("Content-Security-Policy"), policy);
    await missing.text();

    h.site.serve = () => Promise.reject(new Error("private filesystem detail"));
    const failed = await h.req("/");
    assertEquals(failed.status, 500);
    assertEquals(await failed.json(), { error: "internal error" });
    sharedHeaders(failed);
    assertEquals(failed.headers.get("Content-Security-Policy"), policy);

    h.db.sessions.get = () => Promise.reject(new Error("private database detail"));
    const apiFailure = await h.req("/api/auth/me", {
      headers: { Cookie: `${SECURE_SESSION_COOKIE}=test` },
    });
    assertEquals(apiFailure.status, 500);
    assertEquals(await apiFailure.json(), { error: "internal error" });
    sharedHeaders(apiFailure);
    assertEquals(apiFailure.headers.get("Content-Security-Policy"), API_CSP);
    assertEquals(apiFailure.headers.get("Content-Security-Policy-Report-Only"), null);
    assertEquals(apiFailure.headers.get("Cache-Control"), "no-store");
  } finally {
    await h.close();
  }
});

Deno.test("site: Markdown downloads keep API authorization and never fall through to HTML", async () => {
  const h = await siteHarness();
  try {
    const row = await h.db.initiatives.insert({
      title: "Published example",
      status: "approved",
      contact: "private@example.com",
    });
    const publicFile = await h.req(`/initiative/${row.slug}.md`);
    assertEquals(publicFile.status, 200);
    assertStringIncludes(publicFile.headers.get("Content-Type")!, "text/markdown");
    assertEquals(publicFile.headers.get("Cache-Control"), "public, max-age=60");
    assertEquals(publicFile.headers.get("Content-Security-Policy"), API_CSP);
    assert(!(await publicFile.text()).includes("private@example.com"));
    const privatePath = `/initiative/${row.slug}-PRIVATE.md`;
    assertEquals((await h.req(privatePath)).status, 401);
    const plain = await h.mint(PLAIN);
    assertEquals(
      (await h.req(privatePath, { headers: { Authorization: `Bearer ${plain}` } })).status,
      403,
    );
    const admin = await h.mint(ADMIN, true);
    const privateFile = await h.req(privatePath, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assertEquals(privateFile.status, 200);
    assertEquals(privateFile.headers.get("Cache-Control"), "no-store");
    assertStringIncludes(await privateFile.text(), "private@example.com");
  } finally {
    await h.close();
  }
});

Deno.test("site: HEAD, conditional requests and ranges retain static-file semantics", async () => {
  const h = await siteHarness();
  try {
    const asset = await h.req("/assets/app-abc123.js");
    const etag = asset.headers.get("ETag")!;
    assert(etag);
    await asset.text();
    const head = await h.req("/assets/app-abc123.js", { method: "HEAD" });
    assertEquals(head.status, 200);
    assertEquals(await head.text(), "");
    assertEquals(head.headers.get("Content-Length"), String(SCRIPT.length));
    assertEquals(head.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    const cached = await h.req("/assets/app-abc123.js", { headers: { "If-None-Match": etag } });
    assertEquals(cached.status, 304);
    assertEquals(await cached.text(), "");
    sharedHeaders(cached);
    assertEquals(cached.headers.get("Content-Security-Policy"), MINIMAL_CSP);
    const partial = await h.req("/assets/app-abc123.js", { headers: { Range: "bytes=0-5" } });
    assertEquals(partial.status, 206);
    assertEquals(await partial.text(), SCRIPT.slice(0, 6));
    sharedHeaders(partial);
  } finally {
    await h.close();
  }
});

Deno.test("site: the combined app uses runtime IPs and rejects missing identity", async () => {
  const h = await siteHarness();
  try {
    for (const ip of ["203.0.113.42", "203.0.113.43"]) {
      const res = await h.req("/api/auth/nonce", {
        headers: { "X-Forwarded-For": "198.51.100.1" },
      }, ip);
      assertEquals(res.status, 200);
    }
    const quotaNames = [];
    for await (const entry of h.kv.list({ prefix: ["rl"] })) quotaNames.push(entry.key[1]);
    assertEquals(quotaNames.sort(), ["nonce:203.0.113.42", "nonce:203.0.113.43"]);
    assertEquals((await h.app.request(PREVIEW + "/api/auth/nonce")).status, 503);
  } finally {
    await h.close();
  }
});
