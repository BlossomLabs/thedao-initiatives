import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { ADMIN, harness, ORIGIN, PLAIN } from "./app-helpers.ts";
import { createSiteLock, LOCK_COOKIE } from "../lib/sitelock.ts";
import { wallet } from "./helpers.ts";

const BASIC = "Basic " + btoa("preview:s3cret");

Deno.test("site lock: signed cookies reject tampering, another origin and secret rotation", async () => {
  let now = 1_800_000_000;
  const config = {
    siteUsername: "preview",
    sitePassword: "s3cret",
    siteCookieKey: "12".repeat(32),
  };
  const lock = createSiteLock(config, () => Promise.resolve(false), () => now);
  const origin = "https://preview.test";
  const request = new Request(origin);
  const issued = await lock.cookie(request);
  for (const flag of ["__Host-site_lock=", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
    assertStringIncludes(issued, flag);
  }
  assert(!issued.includes("Domain="));
  const cookie = issued.split(";")[0];
  assert(cookie !== (await lock.cookie(request)).split(";")[0]);
  const withCookie = (value: string, url = origin) =>
    new Request(url, { headers: { Cookie: value } });
  assertEquals(await lock.check(withCookie(cookie)), "cookie");
  assertEquals(await lock.check(withCookie(cookie, "https://other.test")), "denied");
  assertEquals(await lock.check(withCookie(cookie, "http://preview.test")), "denied");
  const extended = cookie.replace(String(now + 30 * 86400), String(now + 30 * 86400 + 1));
  now++;
  assertEquals(await lock.check(withCookie(extended)), "denied");
  const corrupted = cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0");
  assertEquals(await lock.check(withCookie(corrupted)), "denied");
  const rotated = createSiteLock(
    { ...config, sitePassword: "rotated" },
    () => Promise.resolve(false),
    () => now,
  );
  assertEquals(await rotated.check(withCookie(cookie)), "denied");
  const rekeyed = createSiteLock(
    { ...config, siteCookieKey: "34".repeat(32) },
    () => Promise.resolve(false),
    () => now,
  );
  assertEquals(await rekeyed.check(withCookie(cookie)), "denied");
  now += 30 * 86400 - 2;
  assertEquals(await lock.check(withCookie(cookie)), "cookie");
  now++;
  assertEquals(await lock.check(withCookie(cookie)), "denied");
});

Deno.test("site lock: enabled preview refuses a missing or malformed independent signing key", () => {
  for (const siteCookieKey of ["", "password", "ab".repeat(31), "xx".repeat(32)]) {
    assertThrows(
      () =>
        createSiteLock(
          { siteUsername: "preview", sitePassword: "secret", siteCookieKey },
          () => Promise.resolve(false),
        ),
      Error,
      "SITE_COOKIE_KEY",
    );
  }
});

Deno.test("site lock: off by default", async () => {
  const h = await harness();
  assertEquals((await h.req("/api/board")).status, 200);
  h.close();
});

Deno.test("site lock: a copied unlock cookie expires on the server after thirty days", async () => {
  const h = await harness({ env: { SITE_USERNAME: "preview", SITE_PASSWORD: "s3cret" } });
  try {
    const opened = await h.req("/api/board", { headers: { Authorization: BASIC } });
    const cookie = opened.headers.get("Set-Cookie")!.split(";")[0];
    assertEquals((await h.req("/api/board", { headers: { Cookie: cookie } })).status, 200);
    h.clock.now += 30 * 86400;
    assertEquals((await h.req("/api/board", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("site lock: basic -> cookie -> bearer session; healthz stays open", async () => {
  const h = await harness({ env: { SITE_USERNAME: "preview", SITE_PASSWORD: "s3cret" } });
  try {
    const denied = await h.req("/api/board");
    assertEquals(denied.status, 401);
    assertStringIncludes(denied.headers.get("WWW-Authenticate") ?? "", "Basic");
    assertEquals((await h.req("/healthz")).status, 200);

    const wrong = await h.req("/api/board", {
      headers: { Authorization: "Basic " + btoa("preview:nope") },
    });
    assertEquals(wrong.status, 401);

    const ok = await h.req("/api/board", { headers: { Authorization: BASIC } });
    assertEquals(ok.status, 200);
    const setCookie = ok.headers.get("Set-Cookie") ?? "";
    assertStringIncludes(setCookie, LOCK_COOKIE + "=");
    assertStringIncludes(setCookie, "HttpOnly");
    const cookie = setCookie.split(";")[0];

    // The unlock cookie carries the browser's later bearer calls through.
    const viaCookie = await h.req("/api/board", { headers: { Cookie: cookie } });
    assertEquals(viaCookie.status, 200);
    assertEquals(viaCookie.headers.get("Set-Cookie"), null);
    const forged = await h.req("/api/board", { headers: { Cookie: LOCK_COOKIE + "=deadbeef" } });
    assertEquals(forged.status, 401);

    // A live session on its own passes (dev scripts with ADMIN_TOKEN); a bogus one does not.
    const token = await h.mint(ADMIN, true);
    const me = await h.req("/api/auth/me", { token });
    assertEquals(me.status, 200);
    assert((await me.json()).isAdmin);
    assertEquals((await h.req("/api/auth/me", { token: "not-a-session" })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("admin promotion requires fresh authentication; demotion removes access immediately", async () => {
  const h = await harness();
  try {
    const token = await h.mint(PLAIN, false);
    assertEquals((await h.req("/api/admin/todo", { token })).status, 403);
    h.deps.config.adminAddresses.push(PLAIN);
    assertEquals((await h.req("/api/admin/todo", { token })).status, 403);
    assertEquals((await (await h.req("/api/auth/me", { token })).json()).isAdmin, false);

    const signer = wallet("0x" + "22".repeat(32));
    const nonce = await h.db.sessions.issueNonce();
    const message =
      `localhost:5173 wants you to sign in with your Ethereum account:\n${signer.address}\n\n` +
      `Sign in\n\nURI: ${ORIGIN}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\n` +
      `Issued At: ${new Date(h.clock.now * 1000).toISOString()}`;
    const login = await h.req("/api/auth/verify", {
      method: "POST",
      token,
      json: { message, signature: await signer.sign(message) },
    });
    assertEquals(login.status, 200);
    const fresh = await login.json() as { token: string; isAdmin: boolean };
    assertEquals(fresh.isAdmin, true);
    assertEquals((await h.req("/api/admin/todo", { token: fresh.token })).status, 200);
    assertEquals((await h.req("/api/auth/me", { token })).status, 401);

    // No clock advance: authorization must not wait for a cached role snapshot.
    h.deps.config.adminAddresses.splice(h.deps.config.adminAddresses.indexOf(PLAIN), 1);
    assertEquals((await h.req("/api/admin/todo", { token: fresh.token })).status, 403);
    assertEquals(
      (await (await h.req("/api/auth/me", { token: fresh.token })).json()).isAdmin,
      false,
    );
  } finally {
    h.close();
  }
});
