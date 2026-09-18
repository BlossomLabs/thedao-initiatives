import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  ADMIN_SESSION_IDLE_SECS,
  ADMIN_SESSION_TTL_SECS,
  SESSION_IDLE_SECS,
  SESSION_REAUTH_SECS,
  SESSION_TTL_SECS,
} from "../config.ts";
import { K } from "../db/keys.ts";
import { sessionsRepo } from "../db/sessions.ts";
import type { Session } from "../db/types.ts";
import { sha256Hex } from "../lib/ids.ts";
import { ADMIN, type Harness, harness, j, ORIGIN, PLAIN } from "./app-helpers.ts";
import { wallet } from "./helpers.ts";
import { createAdmins } from "../services/admins.ts";

const plainWallet = wallet("0x" + "22".repeat(32));
const adminWallet = wallet("0x" + "11".repeat(32));

async function signIn(h: Harness, token = "", who = plainWallet, cookie = false) {
  const { nonce } = await j(await h.req("/api/auth/nonce"));
  const message =
    `localhost:5173 wants you to sign in with your Ethereum account:\n${who.address}\n\n` +
    `Sign in to TheDAO Security Fund\n\nURI: ${ORIGIN}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\n` +
    `Issued At: ${new Date(h.clock.now * 1000).toISOString()}`;
  return await h.req("/api/auth/verify", {
    method: "POST",
    token: cookie ? undefined : token,
    headers: cookie && token ? { Cookie: "session=" + token } : {},
    json: { message, signature: await who.sign(message), cookie },
  });
}

Deno.test("reauthentication invalidates the presented bearer or cookie, and leaves other devices intact", async () => {
  const h = await harness();
  try {
    for (const cookie of [false, true]) {
      const old = await h.mint(PLAIN);
      const other = await h.mint(PLAIN);
      const res = await signIn(h, old, plainWallet, cookie);
      assertEquals(res.status, 200);
      const token = cookie
        ? res.headers.get("Set-Cookie")!.split(";")[0].slice("session=".length)
        : String((await j(res)).token);
      assert(token !== old);
      assertEquals((await h.req("/api/auth/me", { token: old })).status, 401);
      assertEquals((await h.req("/api/auth/me", { token })).status, 200);
      assertEquals((await h.req("/api/auth/me", { token: other })).status, 200);
    }
  } finally {
    h.close();
  }
});

Deno.test("idle deadlines slide with activity, absolute deadlines never do", async () => {
  const h = await harness();
  try {
    for (const isAdmin of [false, true]) {
      const idle = isAdmin ? ADMIN_SESSION_IDLE_SECS : SESSION_IDLE_SECS;
      const absolute = isAdmin ? ADMIN_SESSION_TTL_SECS : SESSION_TTL_SECS;
      const { token, session } = await h.db.sessions.create(isAdmin ? ADMIN : PLAIN, isAdmin);
      h.clock.now += idle - 1;
      assert(await h.db.sessions.get(token));
      h.clock.now += idle - 1;
      assert(await h.db.sessions.get(token));
      h.clock.now += idle;
      assertEquals(await h.db.sessions.get(token), null);
      // A fixture with recent activity isolates the absolute expiry condition.
      await h.kv.set(K.session(sha256Hex(token)), {
        ...session,
        lastSeenAt: session.createdAt + absolute - 1,
      });
      h.clock.now = session.createdAt + absolute;
      assertEquals(await h.db.sessions.get(token), null);
    }
  } finally {
    h.close();
  }
});

Deno.test("administrator access is bounded by authentication privilege and its absolute limit", async () => {
  const h = await harness();
  try {
    const ordinary = await h.mint(PLAIN);
    // Simulate an environment-level promotion, which does not call the admin service.
    h.deps.config.adminAddresses.push(PLAIN);
    h.clock.now += 6;
    assertEquals((await h.req("/api/admin/admins", { token: ordinary })).status, 403);
    const fresh = await signIn(h, ordinary);
    assertEquals(fresh.status, 200);
    const info = await j(fresh) as { token: string; isAdmin: boolean; expiresAt: number };
    assertEquals(info.isAdmin, true);
    assertEquals(info.expiresAt, h.clock.now + ADMIN_SESSION_TTL_SECS);
    assertEquals((await h.req("/api/admin/admins", { token: info.token })).status, 200);
    assertEquals((await h.req("/api/auth/me", { token: ordinary })).status, 401);
    // An erroneously extended row still cannot outlive the administrator cap.
    const key = K.session(sha256Hex(info.token));
    const row = (await h.kv.get<Session>(key)).value!;
    h.clock.now += ADMIN_SESSION_TTL_SECS;
    await h.kv.set(key, {
      ...row,
      expiresAt: h.clock.now + SESSION_TTL_SECS,
      lastSeenAt: h.clock.now,
    });
    assertEquals((await h.req("/api/admin/admins", { token: info.token })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("session inventory is private; remote termination needs fresh auth and checks ownership", async () => {
  const h = await harness();
  try {
    const current = await h.mint(PLAIN);
    const remote = await h.mint(PLAIN);
    const other = await h.mint(ADMIN, true);
    const res = await h.req("/api/auth/sessions", { token: current });
    assertEquals(res.status, 200);
    const { sessions } = await j(res) as {
      sessions: Awaited<ReturnType<typeof h.db.sessions.list>>;
    };
    assertEquals(sessions.length, 2);
    assertEquals(sessions.filter((s: { current: boolean }) => s.current).length, 1);
    const target = sessions.find((s: { current: boolean }) => !s.current)!;
    for (const s of sessions) {
      assertEquals(Object.keys(s).sort(), [
        "createdAt",
        "current",
        "expiresAt",
        "id",
        "isAdmin",
        "lastSeenAt",
      ]);
      assertFalse(JSON.stringify(s).includes(sha256Hex(remote)));
      assertFalse(JSON.stringify(s).includes(remote));
    }
    assertEquals((await h.req("/api/auth/sessions")).status, 401);
    assertEquals(
      (await h.req(`/api/auth/sessions/${target.id}`, { method: "DELETE", token: other })).status,
      404,
    );
    h.clock.now += SESSION_REAUTH_SECS;
    assertEquals(
      (await h.req(`/api/auth/sessions/${target.id}`, { method: "DELETE", token: current })).status,
      403,
    );
    assertEquals(
      (await h.req("/api/auth/logout-all", { method: "POST", token: current })).status,
      403,
    );
    const reauthed = await j(await signIn(h, current)) as { token: string };
    assertEquals(
      (await h.req(`/api/auth/sessions/${target.id}`, { method: "DELETE", token: reauthed.token }))
        .status,
      200,
    );
    assertEquals((await h.req("/api/auth/me", { token: remote })).status, 401);
    assertEquals((await h.req("/api/auth/me", { token: reauthed.token })).status, 200);
    assertEquals((await h.req("/api/auth/me", { token: other })).status, 200);
    assertEquals(
      (await h.req("/api/auth/logout-all", { method: "POST", token: reauthed.token })).status,
      200,
    );
    assertEquals((await h.req("/api/auth/me", { token: reauthed.token })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("administrator per-user and global revocation require recent privileged authentication", async () => {
  const h = await harness();
  try {
    const user = await h.mint(PLAIN);
    let admin = await h.mint(ADMIN, true);
    const revoke = (token: string, address: string) =>
      h.req("/api/admin/sessions/revoke", { method: "POST", token, json: { address } });
    assertEquals((await revoke(user, ADMIN)).status, 403);
    assertEquals((await revoke(admin, "not an address")).status, 400);
    h.clock.now += SESSION_REAUTH_SECS;
    assertEquals((await revoke(admin, PLAIN)).status, 403);
    admin = String((await j(await signIn(h, admin, adminWallet))).token);
    assertEquals((await revoke(admin, PLAIN)).status, 200);
    assertEquals((await h.req("/api/auth/me", { token: user })).status, 401);
    assertEquals((await h.req("/api/auth/me", { token: admin })).status, 200);
    const newUser = await h.mint(PLAIN);
    assertEquals(
      (await h.req("/api/admin/sessions/revoke-all", { method: "POST", token: admin, json: {} }))
        .status,
      400,
    );
    assertEquals(
      (await h.req("/api/admin/sessions/revoke-all", {
        method: "POST",
        token: admin,
        json: { confirmation: "revoke all sessions" },
      })).status,
      200,
    );
    for (const token of [admin, user, newUser]) {
      assertEquals((await h.req("/api/auth/me", { token })).status, 401);
    }
    const next = await h.mint(PLAIN);
    assertEquals((await h.req("/api/auth/me", { token: next })).status, 200);
  } finally {
    h.close();
  }
});

Deno.test("revocation wins a concurrent session activity write", async () => {
  const h = await harness();
  try {
    for (const global of [false, true]) {
      const token = await h.mint(PLAIN);
      let intercepted = false;
      const racingKv = new Proxy(h.kv, {
        get(target, property) {
          if (property === "getMany") {
            return async (keys: Deno.KvKey[]) => {
              const snapshot = await target.getMany(keys);
              if (!intercepted) {
                intercepted = true;
                if (global) await h.db.sessions.revokeGlobal();
                else await h.db.sessions.revoke(token);
              }
              return snapshot;
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      assertEquals(await sessionsRepo(racingKv, () => h.clock.now).get(token), null);
      assertEquals(await h.db.sessions.get(token), null);
    }
  } finally {
    h.close();
  }
});

Deno.test("partially upgraded session rows cannot acquire a fresh inactivity window", async () => {
  const h = await harness();
  try {
    const token = "legacy-token";
    await h.kv.set(K.session(sha256Hex(token)), {
      id: "partial-upgrade",
      address: ADMIN,
      isAdmin: true,
      createdAt: h.clock.now,
      expiresAt: h.clock.now + SESSION_TTL_SECS,
    });
    assertEquals((await h.req("/api/auth/me", { token })).status, 401);
  } finally {
    h.close();
  }
});

Deno.test("passive funding polls and preview-lock checks do not extend inactivity", async () => {
  const h = await harness({ env: { SITE_USERNAME: "preview", SITE_PASSWORD: "secret" } });
  try {
    const token = await h.mint(ADMIN, true);
    // Fifteen whole-second steps; the last lands exactly on the limit.
    const start = h.clock.now;
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      h.clock.now = start + Math.floor(ADMIN_SESSION_IDLE_SECS * i / steps);
      const response = await h.req("/api/auth/me", {
        headers: { Cookie: "session=" + token, "X-Session-Activity": "passive" },
      });
      assertEquals(response.status, i < steps ? 200 : 401);
    }
    assertEquals(await h.db.sessions.get(token), null);
  } finally {
    h.close();
  }
});

Deno.test("promotion does not grant comment fast-lane or voting privileges to an ordinary session", async () => {
  const h = await harness();
  try {
    const token = await h.mint(PLAIN);
    await h.db.initiatives.insert({ title: "Promotion test", status: "approved" });
    const rfp = (await h.db.initiatives.list(["approved"]))[0];
    h.deps.config.adminAddresses.push(PLAIN);
    h.clock.now += 6;
    const path = `/api/initiatives/${rfp.slug}/comments`;
    const before = await j(await h.req(path, { token }));
    assertEquals(before.viewerCanVote, false);
    assertFalse((before.viewerRoles as string[]).includes("ADMIN"));
    const posted = await j(
      await h.req(path, {
        method: "POST",
        token,
        json: {
          body: "Does this promoted wallet have permission?",
        },
      }),
    );
    assertEquals(posted.status, "held"); // No admin bypass of the unavailable AI screen.
    const fresh = String((await j(await signIn(h, token))).token);
    const after = await j(await h.req(path, { token: fresh }));
    assertEquals(after.viewerCanVote, true);
    assert((after.viewerRoles as string[]).includes("ADMIN"));
  } finally {
    h.close();
  }
});

Deno.test("administrator authorization ignores another instance's stale display snapshot after removal", async () => {
  const h = await harness();
  try {
    await h.deps.admins.add(PLAIN);
    const otherInstance = createAdmins(h.db, h.deps.config, h.deps.now);
    assert((await otherInstance.set()).has(PLAIN.toLowerCase()));
    assert(await otherInstance.isAdmin(PLAIN));
    await h.deps.admins.remove(PLAIN, ADMIN);
    // The display snapshot still has the role, but must not authorize a login.
    assert((await otherInstance.set()).has(PLAIN.toLowerCase()));
    assertFalse(await otherInstance.isAdmin(PLAIN));
    const { session } = await h.db.sessions.create(PLAIN, await otherInstance.isAdmin(PLAIN));
    assertFalse(session.isAdmin);
  } finally {
    h.close();
  }
});
