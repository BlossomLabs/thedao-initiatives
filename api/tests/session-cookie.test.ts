/** HttpOnly session cookie for the browser (lib/session-cookie.ts); bearer for scripts. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, type Harness, harness, j, ORIGIN, testConnection } from "./app-helpers.ts";
import { wallet } from "./helpers.ts";
import {
  clearSessionCookie,
  PLAIN_SESSION_COOKIE,
  readSessionCookie,
  SECURE_SESSION_COOKIE,
  sessionCookieName,
  setSessionCookie,
} from "../lib/session-cookie.ts";
import { ADMIN_SESSION_TTL_SECS, SESSION_TTL_SECS } from "../config.ts";

const w = wallet("0x" + "11".repeat(32)); // = ADMIN

/** A freshly signed SIWE message for the harness origin. */
async function signed(h: Harness, who = w) {
  const { nonce } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
  const message =
    `localhost:5173 wants you to sign in with your Ethereum account:\n${who.address}\n\n` +
    `Sign in to TheDAO Security Fund\n\nURI: ${ORIGIN}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\n` +
    `Issued At: ${new Date(h.clock.now * 1000).toISOString()}`;
  return { message, signature: await who.sign(message) };
}

const cookieAttrs = (setCookie: string) =>
  setCookie.split(";").slice(1).map((a) => a.trim().toLowerCase());

Deno.test("verify with cookie: true sets an HttpOnly cookie and omits the token", async () => {
  const h = await harness();
  try {
    const res = await h.req("/api/auth/verify", {
      method: "POST",
      json: { ...(await signed(h)), cookie: true },
    });
    assertEquals(res.status, 200);
    const body = await j(res);
    assertEquals(body.address, ADMIN);
    assertEquals(body.isAdmin, true);
    assertEquals(body.expiresAt, h.clock.now + ADMIN_SESSION_TTL_SECS);
    assert(!("token" in body), "token must not be in the body");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    // http://api.test -> the plain cookie, no Secure
    assertStringIncludes(setCookie, PLAIN_SESSION_COOKIE + "=");
    const attrs = cookieAttrs(setCookie);
    assert(attrs.includes("httponly"), setCookie);
    assert(attrs.includes("samesite=lax"), setCookie);
    assert(attrs.includes("path=/"), setCookie);
    assert(attrs.includes(`max-age=${ADMIN_SESSION_TTL_SECS}`), setCookie);
    assert(!attrs.includes("secure"), setCookie);
    const cookie = setCookie.split(";")[0];
    assert(cookie.length > PLAIN_SESSION_COOKIE.length + 20, "cookie carries the token");

    // Only the cookie authenticates the browser.
    const me = await h.req("/api/auth/me", { headers: { Cookie: cookie } });
    assertEquals(me.status, 200);
    assertEquals((await j(me)).address, ADMIN);
    const admin = await h.req("/api/admin/dashboard", { headers: { Cookie: cookie } });
    assertEquals(admin.status, 200);
    assertEquals((await h.req("/api/auth/me")).status, 401);
    // The admin flag is still re-read per request.
    h.deps.config.adminAddresses.length = 0;
    h.clock.now += 10;
    assertEquals(
      (await j(await h.req("/api/auth/me", { headers: { Cookie: cookie } }))).isAdmin,
      false,
    );
    h.deps.config.adminAddresses.push(ADMIN);
    h.clock.now += 10;

    // A bogus bearer beside a valid cookie does not fall back to the cookie.
    const both = await h.req("/api/auth/me", {
      token: "not-a-session",
      headers: { Cookie: cookie },
    });
    assertEquals(both.status, 401);
    // ...but the browser's cached Basic credentials (preview lock) do not shadow it.
    const basic = await h.req("/api/auth/me", {
      headers: { Cookie: cookie, Authorization: "Basic " + btoa("x:y") },
    });
    assertEquals(basic.status, 200);

    // Logout revokes the session and clears the cookie.
    const out = await h.req("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    assertEquals(out.status, 200);
    const cleared = out.headers.get("Set-Cookie") ?? "";
    assertStringIncludes(cleared, PLAIN_SESSION_COOKIE + "=;");
    assert(cookieAttrs(cleared).includes("max-age=0"), cleared);
    assert(cookieAttrs(cleared).includes("httponly"), cleared);
    assertEquals((await h.req("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("verify without cookie: true still returns the token and sets no cookie", async () => {
  const h = await harness();
  try {
    const res = await h.req("/api/auth/verify", { method: "POST", json: await signed(h) });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Set-Cookie"), null);
    const body = await j(res) as { token: string; address: string };
    assert(typeof body.token === "string" && body.token.length > 20);
    assertEquals(body.address, ADMIN);
    assertEquals((await h.req("/api/auth/me", { token: body.token })).status, 200);
    // `cookie` must be exactly true; a truthy string keeps the bearer contract.
    h.clock.now += 61;
    const str = await h.req("/api/auth/verify", {
      method: "POST",
      json: { ...(await signed(h)), cookie: "yes" },
    });
    assertEquals(str.status, 200);
    assertEquals(str.headers.get("Set-Cookie"), null);
    assert(typeof (await j(str)).token === "string");
  } finally {
    h.close();
  }
});

Deno.test("a bad signature gets 401 and no cookie, even with cookie: true", async () => {
  const h = await harness();
  try {
    const { message } = await signed(h);
    const res = await h.req("/api/auth/verify", {
      method: "POST",
      json: { message, signature: "0x" + "ab".repeat(65), cookie: true },
    });
    assertEquals(res.status, 401);
    assertEquals(res.headers.get("Set-Cookie"), null);
  } finally {
    h.close();
  }
});

Deno.test("logout-all clears the cookie and revokes every session of the address", async () => {
  const h = await harness();
  try {
    const p = wallet("0x" + "22".repeat(32));
    const res = await h.req("/api/auth/verify", {
      method: "POST",
      json: { ...(await signed(h, p)), cookie: true },
    });
    assertEquals(res.status, 200);
    assertEquals((await j(res)).expiresAt, h.clock.now + SESSION_TTL_SECS);
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0];
    const bearer = await h.mint(p.address);
    const out = await h.req("/api/auth/logout-all", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assertEquals(out.status, 200);
    assertEquals((await j(out)).revoked, 2);
    assert(cookieAttrs(out.headers.get("Set-Cookie") ?? "").includes("max-age=0"));
    assertEquals((await h.req("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
    assertEquals((await h.req("/api/auth/me", { token: bearer })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("site lock: a valid session cookie passes, a stale one does not", async () => {
  const h = await harness({ env: { SITE_USERNAME: "preview", SITE_PASSWORD: "s3cret" } });
  try {
    const token = await h.mint(ADMIN, true);
    const cookie = `${PLAIN_SESSION_COOKIE}=${token}`;
    assertEquals((await h.req("/api/board", { headers: { Cookie: cookie } })).status, 200);
    const me = await h.req("/api/auth/me", { headers: { Cookie: cookie } });
    assertEquals(me.status, 200);
    assertEquals((await j(me)).address, ADMIN);
    await h.db.sessions.revoke(token);
    const gone = await h.req("/api/board", { headers: { Cookie: cookie } });
    assertEquals(gone.status, 401);
    assertStringIncludes(gone.headers.get("WWW-Authenticate") ?? "", "Basic");
    // The lock's own check() is what server.ts calls for static pages.
    const { siteLockFor } = await import("../app.ts");
    const lock = siteLockFor(h.deps);
    const live = await h.mint(ADMIN, true);
    assertEquals(
      await lock.check(new Request("http://api.test/", { headers: { Cookie: `session=${live}` } })),
      "session",
    );
    assertEquals(await lock.check(new Request("http://api.test/")), "denied");
  } finally {
    h.close();
  }
});

Deno.test("cookie name: __Host- + Secure over https, plain over http, forwarding headers ignored", async () => {
  const https = new Request("https://initiatives.thedao.fund/api/auth/verify");
  const http = new Request("http://localhost:8000/api/auth/verify");
  assertEquals(sessionCookieName(https), SECURE_SESSION_COOKIE);
  assertEquals(sessionCookieName(http), PLAIN_SESSION_COOKIE);

  const secure = setSessionCookie(https, "tok", 60);
  assertEquals(
    secure,
    "__Host-session=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
  );
  assertEquals(
    setSessionCookie(http, "tok", 60),
    "session=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax",
  );
  assertEquals(
    clearSessionCookie(https),
    "__Host-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
  );
  assertEquals(
    clearSessionCookie(http),
    "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
  );

  // Forwarding headers cannot select or downgrade the session cookie.
  const fwd = new Request("http://app.internal/api", { headers: { "X-Forwarded-Proto": "https" } });
  assertEquals(sessionCookieName(fwd), PLAIN_SESSION_COOKIE);
  const back = new Request("https://app/api", { headers: { "X-Forwarded-Proto": "http, https" } });
  assertEquals(sessionCookieName(back), SECURE_SESSION_COOKIE);

  // Reading follows the same name, so a plain cookie is ignored on https.
  const withBoth = (url: string) =>
    new Request(url, { headers: { Cookie: "session=plain; __Host-session=host; other=x" } });
  assertEquals(readSessionCookie(withBoth("https://x/")), "host");
  assertEquals(readSessionCookie(withBoth("http://x/")), "plain");
  assertEquals(readSessionCookie(new Request("https://x/")), "");

  // End to end: verify over an https URL gets the __Host- cookie and it authenticates.
  const h = await harness({ env: { WEB_ORIGIN: "https://preview.deno.net" } });
  try {
    const { nonce } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
    const message =
      `preview.deno.net wants you to sign in with your Ethereum account:\n${w.address}\n\n` +
      `Sign in to TheDAO Security Fund\n\nURI: https://preview.deno.net\nVersion: 1\nChain ID: 1\n` +
      `Nonce: ${nonce}\nIssued At: ${new Date(h.clock.now * 1000).toISOString()}`;
    const res = await h.app.request("https://preview.deno.net/api/auth/verify", {
      method: "POST",
      headers: { Origin: "https://preview.deno.net", "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature: await w.sign(message), cookie: true }),
    }, testConnection());
    assertEquals(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    assertStringIncludes(setCookie, SECURE_SESSION_COOKIE + "=");
    assert(cookieAttrs(setCookie).includes("secure"), setCookie);
    const cookie = setCookie.split(";")[0];
    const me = await h.app.request("https://preview.deno.net/api/auth/me", {
      headers: { Cookie: cookie },
    });
    assertEquals(me.status, 200);
    // The same token under the plain name is not accepted on https.
    const plain = await h.app.request("https://preview.deno.net/api/auth/me", {
      headers: { Cookie: cookie.replace(SECURE_SESSION_COOKIE, PLAIN_SESSION_COOKIE) },
    });
    assertEquals(plain.status, 401);
  } finally {
    h.close();
  }
});

Deno.test("POST /api/auth/cookie: a pre-cookie bearer session gets its cookie, same expiry", async () => {
  const h = await harness();
  try {
    // A session minted the old way (bearer in the body, no cookie).
    const res = await h.req("/api/auth/verify", { method: "POST", json: await signed(h) });
    const { token, expiresAt } = await j(res) as { token: string; expiresAt: number };
    h.clock.now += 600;

    const mig = await h.req("/api/auth/cookie", { method: "POST", token });
    assertEquals(mig.status, 200);
    const body = await j(mig);
    assertEquals(body, { address: ADMIN, isAdmin: true, expiresAt });
    assert(!("token" in body));
    const setCookie = mig.headers.get("Set-Cookie") ?? "";
    assertStringIncludes(setCookie, `${PLAIN_SESSION_COOKIE}=${token};`);
    const attrs = cookieAttrs(setCookie);
    assert(attrs.includes("httponly"), setCookie);
    assert(attrs.includes("samesite=lax"), setCookie);
    // The remaining lifetime, not a fresh TTL.
    assert(attrs.includes(`max-age=${ADMIN_SESSION_TTL_SECS - 600}`), setCookie);

    // The cookie alone now authenticates, and it is the same session (one row
    // to revoke).
    const cookie = setCookie.split(";")[0];
    assertEquals((await h.req("/api/auth/me", { headers: { Cookie: cookie } })).status, 200);
    await h.req("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    assertEquals((await h.req("/api/auth/me", { token })).status, 401);

    // Without a live session there is nothing to migrate.
    assertEquals((await h.req("/api/auth/cookie", { method: "POST", token })).status, 401);
    assertEquals((await h.req("/api/auth/cookie", { method: "POST" })).status, 401);
  } finally {
    h.close();
  }
});
