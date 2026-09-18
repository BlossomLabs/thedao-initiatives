import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { siteLockFor } from "../app.ts";
import {
  ADMIN_SESSION_IDLE_SECS,
  ADMIN_SESSION_TTL_SECS,
  SESSION_IDLE_SECS,
  SESSION_TTL_SECS,
} from "../config.ts";
import { K } from "../db/keys.ts";
import { sessionsRepo } from "../db/sessions.ts";
import type { Session } from "../db/types.ts";
import { randomToken, sha256Hex } from "../lib/ids.ts";
import { ADMIN, type Harness, harness, j, PLAIN } from "./app-helpers.ts";

type LegacySession = Pick<Session, "address" | "isAdmin" | "createdAt" | "expiresAt">;

/** The exact schema written before session lifecycle hardening. */
async function seedLegacy(h: Harness, overrides: Partial<LegacySession> = {}) {
  const token = randomToken();
  const hash = sha256Hex(token);
  const session: LegacySession = {
    address: PLAIN,
    isAdmin: false,
    createdAt: h.clock.now - 6 * 86400,
    expiresAt: h.clock.now + 86400,
    ...overrides,
  };
  await h.kv.atomic()
    .set(K.session(hash), session)
    .set(K.sessionsByAddr(session.address, hash), true)
    .commit();
  return { token, hash, session };
}

Deno.test("legacy localStorage bearer upgrades through the cookie exchange without signing in", async () => {
  const h = await harness();
  try {
    const { token, hash, session } = await seedLegacy(h);
    const res = await h.req("/api/auth/cookie", { method: "POST", token });
    assertEquals(res.status, 200);
    const body = await j(res);
    assertEquals(body, { address: PLAIN, isAdmin: false, expiresAt: session.expiresAt });
    assertFalse("token" in body);
    const setCookie = res.headers.get("Set-Cookie")!;
    assertStringIncludes(setCookie, "HttpOnly");
    assertStringIncludes(setCookie, `Max-Age=${session.expiresAt - h.clock.now}`);
    const cookie = setCookie.split(";")[0];
    assertEquals(cookie, `session=${token}`);
    const upgraded = (await h.kv.get<Session>(K.session(hash))).value!;
    assertEquals(upgraded.createdAt, session.createdAt);
    assertEquals(upgraded.lastSeenAt, h.clock.now);
    assertEquals(upgraded.expiresAt, session.expiresAt);
    assert(/^[A-Za-z0-9_-]{22}$/.test(upgraded.id));
    assertEquals((await h.req("/api/auth/me", { headers: { Cookie: cookie } })).status, 200);
    // Migration must not satisfy the fresh wallet signature requirement.
    assertEquals(
      (await h.req("/api/auth/logout-all", { method: "POST", headers: { Cookie: cookie } })).status,
      403,
    );
    await h.db.sessions.revoke(token);
    assertEquals((await h.req("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("existing legacy cookies retain only their original and currently authorized privilege", async () => {
  const h = await harness();
  try {
    const admin = await seedLegacy(h, {
      address: ADMIN,
      isAdmin: true,
      createdAt: h.clock.now - 10 * 3600,
      expiresAt: h.clock.now + 2 * 3600,
    });
    const headers = { Cookie: `session=${admin.token}` };
    assertEquals((await h.req("/api/admin/admins", { headers })).status, 200);
    const row = (await h.kv.get<Session>(K.session(admin.hash))).value!;
    assertEquals(row.createdAt, admin.session.createdAt);
    assertEquals(row.expiresAt, admin.session.expiresAt);
    assertEquals(row.isAdmin, true);

    const ordinary = await seedLegacy(h);
    h.deps.config.adminAddresses.push(PLAIN);
    assertEquals((await h.req("/api/admin/admins", { token: ordinary.token })).status, 403);
    assertEquals((await j(await h.req("/api/auth/me", { token: ordinary.token }))).isAdmin, false);

    // A legacy administrator who was removed cannot regain access through migration.
    const removed = await seedLegacy(h, admin.session);
    h.deps.config.adminAddresses.length = 0;
    assertEquals((await h.req("/api/admin/admins", { token: removed.token })).status, 403);
    assertEquals((await j(await h.req("/api/auth/me", { token: removed.token }))).isAdmin, false);
  } finally {
    h.close();
  }
});

Deno.test("legacy upgrade initializes idle time once, even through passive site-lock reads", async () => {
  const h = await harness({ env: { SITE_USERNAME: "preview", SITE_PASSWORD: "secret" } });
  try {
    const lock = siteLockFor(h.deps);
    for (const isAdmin of [false, true]) {
      const idle = isAdmin ? ADMIN_SESSION_IDLE_SECS : SESSION_IDLE_SECS;
      const ttl = isAdmin ? ADMIN_SESSION_TTL_SECS : SESSION_TTL_SECS;
      const createdAt = h.clock.now - 3600;
      // This measures idle, so the absolute expiry must fall outside the window.
      assert(h.clock.now + idle < createdAt + ttl);
      const { token, hash } = await seedLegacy(h, {
        address: isAdmin ? ADMIN : PLAIN,
        isAdmin,
        createdAt,
        expiresAt: createdAt + ttl,
      });
      const request = new Request("http://api.test/", { headers: { Cookie: `session=${token}` } });
      assertEquals(await lock.check(request), "session");
      const first = (await h.kv.get<Session>(K.session(hash))).value!;
      assertEquals(first.lastSeenAt, h.clock.now);
      h.clock.now += idle - 1;
      assertEquals(await lock.check(request), "session");
      assertEquals((await h.kv.get<Session>(K.session(hash))).value, first);
      h.clock.now++;
      assertEquals(await lock.check(request), "denied");
      assertEquals(await h.db.sessions.get(token), null);
    }
  } finally {
    h.close();
  }
});

Deno.test("upgraded sessions slide idle time but keep the original or stricter absolute deadline", async () => {
  const h = await harness();
  try {
    for (const isAdmin of [false, true]) {
      const idle = isAdmin ? ADMIN_SESSION_IDLE_SECS : SESSION_IDLE_SECS;
      const ttl = isAdmin ? ADMIN_SESSION_TTL_SECS : SESSION_TTL_SECS;
      const { token } = await seedLegacy(h, {
        address: isAdmin ? ADMIN : PLAIN,
        isAdmin,
        createdAt: h.clock.now - ttl + idle + 30,
        // A bad older expiry cannot bypass the lifetime cap.
        expiresAt: h.clock.now + ttl,
      });
      const upgraded = (await h.db.sessions.get(token))!;
      assertEquals(upgraded.expiresAt, h.clock.now + idle + 30);
      h.clock.now += idle - 1;
      const active = (await h.db.sessions.get(token))!;
      assertEquals(active.id, upgraded.id);
      assertEquals(active.lastSeenAt, h.clock.now);
      assertEquals(active.expiresAt, upgraded.expiresAt);
      h.clock.now = upgraded.expiresAt;
      assertEquals(await h.db.sessions.get(token), null);
    }
    const shortened = await seedLegacy(h, { expiresAt: h.clock.now + 10 });
    assertEquals((await h.db.sessions.get(shortened.token))!.expiresAt, h.clock.now + 10);
    h.clock.now += 10;
    assertEquals(await h.db.sessions.get(shortened.token), null);
  } finally {
    h.close();
  }
});

Deno.test("expired, malformed, and partially upgraded legacy rows cannot migrate or receive a cookie", async () => {
  const h = await harness();
  try {
    const invalid = [
      { expiresAt: h.clock.now },
      { createdAt: h.clock.now - SESSION_TTL_SECS },
      { isAdmin: true, createdAt: h.clock.now - ADMIN_SESSION_TTL_SECS },
      { address: "invalid" },
      { isAdmin: "false" },
      { createdAt: NaN },
      { expiresAt: Infinity },
      { createdAt: h.clock.now + 1 },
      { id: "partial" },
      { lastSeenAt: h.clock.now },
      { addressEpoch: "" },
      { globalEpoch: "" },
    ];
    for (const override of invalid) {
      const { token, hash, session } = await seedLegacy(h);
      const row = { ...session, ...override };
      await h.kv.set(K.session(hash), row);
      const res = await h.req("/api/auth/cookie", { method: "POST", token });
      assertEquals(res.status, 401);
      assertEquals(res.headers.get("Set-Cookie"), null);
      assertEquals((await h.kv.get(K.session(hash))).value, row);
    }
    assertEquals(await h.db.sessions.get(randomToken()), null);
  } finally {
    h.close();
  }
});

Deno.test("any persisted wallet or global revocation marker prevents legacy migration", async () => {
  for (const global of [false, true]) {
    const h = await harness();
    try {
      const { token, hash, session } = await seedLegacy(h);
      // Presence matters even for an empty epoch; a legacy row cannot claim it.
      await h.kv.set(global ? K.globalSessionRevocation : K.sessionRevocation(PLAIN), "");
      assertEquals(await h.db.sessions.get(token), null);
      assertEquals((await h.req("/api/auth/cookie", { method: "POST", token })).status, 401);
      assertEquals((await h.kv.get(K.session(hash))).value, session);
      const newToken = await h.mint(PLAIN);
      assert(await h.db.sessions.get(newToken));
    } finally {
      h.close();
    }
  }
});

Deno.test("concurrent legacy upgrades converge on one session and repair its inventory entry", async () => {
  const h = await harness();
  try {
    const { token, hash } = await seedLegacy(h);
    await h.kv.delete(K.sessionsByAddr(PLAIN, hash));
    const [a, b] = await Promise.all([
      h.db.sessions.get(token, false),
      h.db.sessions.get(token, false),
    ]);
    assert(a && b);
    assertEquals(a, b);
    const inventory = await h.db.sessions.list(PLAIN, token);
    assertEquals(inventory.length, 1);
    assertEquals(inventory[0].id, a.id);
    assertEquals(inventory[0].current, true);
    assertFalse(JSON.stringify(inventory).includes(token));
    assertFalse(JSON.stringify(inventory).includes(hash));
  } finally {
    h.close();
  }
});

Deno.test("logout and wallet/global revocation win races against legacy upgrade writes", async () => {
  for (const revocation of ["logout", "wallet", "global"]) {
    const h = await harness();
    try {
      const { token } = await seedLegacy(h);
      let intercepted = false;
      const racingKv = new Proxy(h.kv, {
        get(target, property) {
          if (property === "getMany") {
            return async (keys: Deno.KvKey[]) => {
              const snapshot = await target.getMany(keys);
              if (!intercepted) {
                intercepted = true;
                if (revocation === "logout") await h.db.sessions.revoke(token);
                else if (revocation === "wallet") await h.db.sessions.revokeAll(PLAIN);
                else await h.db.sessions.revokeGlobal();
              }
              return snapshot;
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      assertEquals(await sessionsRepo(racingKv, () => h.clock.now).get(token, false), null);
      assert(intercepted);
      assertEquals(await h.db.sessions.get(token), null);
      assertEquals(await h.db.sessions.list(PLAIN), []);
    } finally {
      h.close();
    }
  }
});
