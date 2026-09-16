import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import {
  ADMIN,
  type Harness,
  harness as appHarness,
  type HarnessOptions,
  j,
  ORIGIN,
  PLAIN,
} from "./app-helpers.ts";
import { wallet } from "./helpers.ts";
import type { AuditEvent } from "../services/audit.ts";
import { sha256Hex } from "../lib/ids.ts";
import { syntheticContentFiles } from "./fixtures.ts";
import { SESSION_REAUTH_SECS } from "../config.ts";

const w = wallet("0x" + "11".repeat(32));
async function signed(h: Harness) {
  const nonce = await h.db.sessions.issueNonce();
  const message =
    `localhost:5173 wants you to sign in with your Ethereum account:\n${w.address}\n\n` +
    `Sign in\n\nURI: ${ORIGIN}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\n` +
    `Issued At: ${new Date(h.clock.now * 1000).toISOString()}`;
  return { message, signature: await w.sign(message) };
}

async function harness(opts?: HarnessOptions) {
  const h = await appHarness(opts);
  const logs: string[] = [];
  h.deps.log = (line) => logs.push(line);
  return { ...h, logs };
}

type AuditHarness = Awaited<ReturnType<typeof harness>>;
const events = (h: AuditHarness): AuditEvent[] =>
  h.logs.filter((line) => line.startsWith('{"securityAudit":true,')).map((line) =>
    JSON.parse(line)
  );
const forRequest = (h: AuditHarness, r: Response) =>
  events(h).filter((e) => e.requestId === r.headers.get("X-Request-ID"));

Deno.test("audit: verified login, reauthentication and revocation emit structured safe metadata", async () => {
  const h = await harness();
  const log = h.logs;
  try {
    const credentials = await signed(h);
    const login = await h.req("/api/auth/verify", {
      method: "POST",
      headers: { "X-Request-ID": "attacker-selected-id" },
      json: credentials,
    });
    assertEquals(login.status, 200);
    assertMatch(login.headers.get("X-Request-ID")!, /^[0-9a-f-]{36}$/);
    const { token } = await j(login) as { token: string };
    const verified = forRequest(h, login).find((e) => e.outcome === "success")!;
    assertEquals(verified.action, "auth.verify");
    assertEquals(verified.actor, ADMIN.toLowerCase());
    assertEquals(verified.target, { kind: "wallet", id: ADMIN.toLowerCase() });
    assertEquals(verified.detail, "login");
    assertEquals(verified.at, new Date(h.clock.now * 1000).toISOString());
    assertFalse("expiresAt" in verified);
    const replacement = await h.req("/api/auth/verify", {
      method: "POST",
      token,
      json: await signed(h),
    });
    const rotated = await j(replacement) as { token: string };
    assertEquals(
      forRequest(h, replacement).find((e) => e.outcome === "success")?.detail,
      "reauthenticate",
    );
    const logout = await h.req("/api/auth/logout", { method: "POST", token: rotated.token });
    assertEquals(
      forRequest(h, logout).find((e) => e.outcome === "success")?.action,
      "session.logout",
    );
    const serialized = JSON.stringify(events(h)) + log.join("\n");
    for (
      const secret of [
        token,
        rotated.token,
        credentials.message,
        credentials.signature,
        "attacker-selected-id",
      ]
    ) {
      assertFalse(serialized.includes(secret));
    }
    // Every event is emitted as a parseable, single JSON line.
    assertEquals(events(h).length, 6);
    assert(log.every((line) => !line.includes("\n")));
    assert(log.every((line) => JSON.parse(line).securityAudit === true));
  } finally {
    h.close();
  }
});

Deno.test("audit: auth failures, early Origin denials, validation and throttling exclude raw input", async () => {
  const h = await harness();
  const log = h.logs;
  const secret = "SENSITIVE-CONTENT-DO-NOT-LOG";
  try {
    const plain = await h.mint(PLAIN);
    const denied = await h.req(`/api/admin/initiatives/${secret}?token=${secret}`, {
      token: plain,
    });
    assertEquals(denied.status, 403);
    assert(
      forRequest(h, denied).some((e) =>
        e.action === "authorization.denied" && e.actor === PLAIN.toLowerCase()
      ),
    );
    const origin = await h.app.request("http://api.test/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example", Authorization: "Bearer " + secret },
    });
    assertEquals(origin.status, 403);
    assert(forRequest(h, origin).some((e) => e.action === "authorization.denied"));
    const malformed = await h.req("/api/auth/verify", {
      method: "POST",
      json: { message: secret, signature: secret },
    });
    assertEquals(malformed.status, 401);
    assert(
      forRequest(h, malformed).some((e) =>
        e.action === "auth.verify" && e.outcome === "failure" && e.actor === null
      ),
    );
    const invalid = await h.req("/api/auth/verify", { method: "POST", json: {} });
    assertEquals(invalid.status, 400);
    assert(forRequest(h, invalid).some((e) => e.action === "validation.rejected"));
    for (let i = 0; i < 4; i++) await h.req("/api/auth/verify", { method: "POST", json: {} });
    assert(events(h).some((e) => e.action === "abuse.limited" && e.status === 429));
    const serialized = JSON.stringify(events(h)) + log.join("\n");
    for (const value of [secret, plain, "https://evil.example", "?token="]) {
      assertFalse(serialized.includes(value));
    }
  } finally {
    h.close();
  }
});

Deno.test("audit: admin changes and mixed bulk outcomes identify each item without private content", async () => {
  const h = await harness();
  try {
    const token = await h.mint(ADMIN, true);
    const added = await h.req("/api/admin/admins", {
      method: "POST",
      token,
      json: { address: PLAIN },
    });
    assertEquals(added.status, 200);
    const addedEvents = forRequest(h, added);
    assert(
      addedEvents.some((e) =>
        e.action === "admin.add" && e.outcome === "success" && e.target.id === PLAIN.toLowerCase()
      ),
    );
    assert(
      addedEvents.some((e) =>
        e.action === "session.admin_revoke" && e.target.id === PLAIN.toLowerCase()
      ),
    );
    const row = await h.db.rfps.insert({
      title: "Private funder title",
      funders: "Private funder",
      status: "pending",
    });
    const bulk = await h.req("/api/admin/initiatives/bulk", {
      method: "POST",
      token,
      json: { ids: [row.id, "missing-secret-id"], action: "reject" },
    });
    assertEquals(bulk.status, 200);
    const bulkEvents = forRequest(h, bulk);
    assert(
      bulkEvents.some((e) =>
        e.action === "initiative.status" && e.outcome === "success" && e.detail === "reject" &&
        e.target.id === sha256Hex(row.id)
      ),
    );
    assert(
      bulkEvents.some((e) =>
        e.action === "initiative.status" && e.outcome === "failure" &&
        e.target.id === sha256Hex("missing-secret-id")
      ),
    );
    assert(bulkEvents.some((e) => e.action === "initiative.bulk" && e.outcome === "partial"));
    const sync = await h.req("/api/admin/sync-content", {
      method: "POST",
      token,
      json: {
        files: [syntheticContentFiles()[0], { name: "broken.md", text: "PRIVATE_BAD_DOCUMENT" }],
      },
    });
    assertEquals(sync.status, 200);
    const syncEvents = forRequest(h, sync);
    assert(syncEvents.some((e) => e.action === "content.item" && e.outcome === "success"));
    assert(syncEvents.some((e) => e.action === "content.item" && e.outcome === "failure"));
    assert(syncEvents.some((e) => e.action === "content.sync" && e.outcome === "partial"));
    const serialized = JSON.stringify(events(h));
    for (
      const secret of [
        row.title,
        row.funders,
        "missing-secret-id",
        "PRIVATE_BAD_DOCUMENT",
        "broken.md",
      ]
    ) {
      assertFalse(serialized.includes(secret));
    }
  } finally {
    h.close();
  }
});

Deno.test("audit: controlled test requires a recently authenticated admin and history is unavailable", async () => {
  const h = await harness();
  try {
    const plain = await h.mint(PLAIN);
    const admin = await h.mint(ADMIN, true);
    assertEquals((await h.req("/api/admin/audit/test", { method: "POST" })).status, 401);
    assertEquals(
      (await h.req("/api/admin/audit/test", { method: "POST", token: plain })).status,
      403,
    );
    const test = await h.req("/api/admin/audit/test", {
      method: "POST",
      token: admin,
      json: { text: "IGNORED_PAYLOAD" },
    });
    assertEquals(test.status, 200);
    assert(
      forRequest(h, test).some((e) => e.action === "audit.test" && e.outcome === "success"),
    );
    assertEquals((await h.req("/api/admin/audit", { token: admin })).status, 404);
    h.clock.now += SESSION_REAUTH_SECS + 1;
    assertEquals(
      (await h.req("/api/admin/audit/test", { method: "POST", token: admin })).status,
      403,
    );
  } finally {
    h.close();
  }
});

Deno.test("audit: each session revocation mode records actor, target and success", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const plain = await h.mint(PLAIN);
    await h.mint(PLAIN);
    const remote = (await h.db.sessions.list(PLAIN, plain)).find((s) => !s.current)!;
    const individual = await h.req(`/api/auth/sessions/${remote.id}`, {
      method: "DELETE",
      token: plain,
    });
    assertEquals(individual.status, 200);
    assert(
      forRequest(h, individual).some((e) =>
        e.action === "session.revoke" && e.outcome === "success" &&
        e.actor === PLAIN.toLowerCase() && e.target.id === sha256Hex(remote.id)
      ),
    );
    const all = await h.req("/api/auth/logout-all", { method: "POST", token: plain });
    assertEquals(all.status, 200);
    assert(
      forRequest(h, all).some((e) =>
        e.action === "session.logout_all" && e.outcome === "success" &&
        e.target.id === PLAIN.toLowerCase()
      ),
    );
    await h.mint(PLAIN);
    const byAdmin = await h.req("/api/admin/sessions/revoke", {
      method: "POST",
      token: admin,
      json: { address: PLAIN },
    });
    assertEquals(byAdmin.status, 200);
    assert(
      forRequest(h, byAdmin).some((e) =>
        e.action === "session.admin_revoke" && e.outcome === "success" &&
        e.actor === ADMIN.toLowerCase() && e.target.id === PLAIN.toLowerCase()
      ),
    );
    const global = await h.req("/api/admin/sessions/revoke-all", {
      method: "POST",
      token: admin,
      json: { confirmation: "revoke all sessions" },
    });
    assertEquals(global.status, 200);
    assert(
      forRequest(h, global).some((e) =>
        e.action === "session.admin_revoke_all" && e.outcome === "success" &&
        e.actor === ADMIN.toLowerCase() && e.target.kind === "application"
      ),
    );
  } finally {
    h.close();
  }
});

Deno.test("audit: events are logged without touching KV", async () => {
  const h = await harness();
  try {
    const token = await h.mint(ADMIN, true);
    // Any audit access through deps.db fails; application services retain their real DB.
    h.deps.db = new Proxy(h.db, {
      get() {
        throw new Error("Audit logging must not access the database");
      },
    });
    const response = await h.req("/api/admin/admins", {
      method: "POST",
      token,
      json: { address: PLAIN },
    });
    assertEquals(response.status, 200);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), true);
    assertEquals(
      forRequest(h, response).filter((e) => e.action === "admin.add").map((e) => e.outcome),
      ["attempt", "success"],
    );
    assertEquals(await Array.fromAsync(h.kv.list({ prefix: ["security_audit"] })), []);
  } finally {
    h.close();
  }
});

Deno.test("audit: unexpected failures emit metadata without raw errors and request data", async () => {
  const h = await harness();
  const log = h.logs;
  try {
    h.app.get("/api/test-failure", () => {
      throw new Error("SECRET_DATABASE_URL");
    });
    const response = await h.req("/api/test-failure?capability=SECRET_CLAIM");
    assertEquals(response.status, 500);
    assert(
      forRequest(h, response).some((e) => e.action === "request.failed" && e.status === 500),
    );
    const text = log.join("\n") + JSON.stringify(events(h)) + await response.text();
    assertFalse(text.includes("SECRET_DATABASE_URL"));
    assertFalse(text.includes("SECRET_CLAIM"));
  } finally {
    h.close();
  }
});

Deno.test("audit: logger failures do not block mutations or change their responses", async () => {
  const h = await harness();
  try {
    h.app.get("/api/test-failure", () => {
      throw new Error("SECRET_DATABASE_URL");
    });
    const token = await h.mint(ADMIN, true);
    // Exercise failures both before mutation and after a successful commit.
    for (const failOn of ["attempt", "success"]) {
      const row = await h.db.rfps.insert({ title: "Audit logger fixture", status: "pending" });
      let failures = 0;
      h.deps.log = (line) => {
        if (JSON.parse(line).outcome === failOn) {
          failures++;
          throw new Error("SECRET_LOGGER_CREDENTIAL");
        }
        h.logs.push(line);
      };
      const response = await h.req(`/api/admin/initiatives/${row.id}/status`, {
        method: "POST",
        token,
        json: { action: "reject" },
      });
      assertEquals(response.status, 200);
      assertEquals((await h.db.rfps.get(row.id))?.status, "rejected");
      assertEquals(failures, 1);
      assertEquals(forRequest(h, response).map((e) => e.outcome), [
        failOn === "attempt" ? "success" : "attempt",
      ]);
      assertFalse((h.logs.join("\n") + await response.text()).includes("SECRET_LOGGER_CREDENTIAL"));
    }
    h.deps.log = () => {
      throw new Error("SECRET_LOGGER_CREDENTIAL");
    };
    const denied = await h.req("/api/admin/audit/test", { method: "POST" });
    assertEquals(denied.status, 401);
    const invalid = await h.req("/api/auth/verify", { method: "POST", json: {} });
    assertEquals(invalid.status, 400);
    const failed = await h.req("/api/test-failure");
    assertEquals(failed.status, 500);
    assertEquals(await j(failed), { error: "internal error" });
  } finally {
    h.close();
  }
});

Deno.test("audit: logo replacement and reuse identify the target without logging its name", async () => {
  const h = await harness({
    env: { PINATA_JWT: "secret-pinata-jwt" },
    fetch: (url) =>
      url.startsWith("https://uploads.pinata.cloud/")
        ? Response.json({ data: { cid: "bafylogo1234567890123456789012345678901234567890" } })
        : new Response("", { status: 404 }),
  });
  const name = "private-sponsor.png";
  const logs = h.logs;
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  try {
    const token = await h.mint(ADMIN, true);
    await h.db.logos.set(name, "previous-cid", "previous-content-hash");
    for (const reused of [false, true]) {
      const body = new FormData();
      body.append("name", name);
      body.append("image", new Blob([png], { type: "image/png" }), name);
      const response = await h.req("/api/admin/logos", { method: "POST", token, body });
      assertEquals(response.status, 200);
      assertEquals((await j(response)).reused, reused);
      const completed = forRequest(h, response).find((e) =>
        e.action === "logo.upload" && e.outcome === "success"
      );
      assert(completed);
      assertEquals(completed.actor, ADMIN.toLowerCase());
      assertEquals(completed.target, { kind: "logo", id: sha256Hex(name) });
    }
    assertEquals(
      (await h.db.logos.get(name))?.cid,
      "bafylogo1234567890123456789012345678901234567890",
    );
    const serialized = JSON.stringify(events(h)) + logs.join("\n");
    assertFalse(serialized.includes(name));
    assertFalse(serialized.includes("secret-pinata-jwt"));
  } finally {
    h.close();
  }
});
