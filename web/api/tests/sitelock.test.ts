import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, PLAIN } from "./app-helpers.ts";
import { LOCK_COOKIE } from "../lib/sitelock.ts";

const BASIC = "Basic " + btoa("preview:s3cret");

Deno.test("site lock: off by default", async () => {
  const h = await harness();
  assertEquals((await h.req("/api/board")).status, 200);
  h.close();
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

Deno.test("admin flag follows ADMIN_ADDRESSES after sign-in, without a new session", async () => {
  const h = await harness();
  // a session minted as a plain user...
  const token = await h.mint(PLAIN, false);
  const before = await h.req("/api/admin/dashboard", { token });
  assertEquals(before.status, 403);
  // ...becomes admin as soon as the address is in the config's list
  h.deps.config.adminAddresses.push(PLAIN);
  const after = await h.req("/api/admin/dashboard", { token });
  assertEquals(after.status, 200);
  const me = await (await h.req("/api/auth/me", { token })).json() as { isAdmin: boolean };
  assertEquals(me.isAdmin, true);
  h.close();
});
