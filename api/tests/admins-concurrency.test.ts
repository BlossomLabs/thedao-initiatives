import { assertEquals } from "@std/assert";
import { ADMINS_META_KEY } from "../services/admins.ts";
import { ADMIN, harness, PLAIN } from "./app-helpers.ts";

const OTHER = "0x3333333333333333333333333333333333333333";

/** Hold the first membership read after its value/version were captured.
 * A competing request commits before the first writer resumes. */
function pauseMembershipRead(kv: Deno.Kv) {
  const original = kv.get.bind(kv);
  let reached!: () => void;
  let release!: () => void;
  const paused = new Promise<void>((resolve) => reached = resolve);
  const resume = new Promise<void>((resolve) => release = resolve);
  let held = false;
  kv.get = (async (key: Deno.KvKey, options?: { consistency?: Deno.KvConsistencyLevel }) => {
    const result = await original(key, options);
    if (!held && key.length === 2 && key[0] === "meta" && key[1] === ADMINS_META_KEY) {
      held = true;
      reached();
      await resume;
    }
    return result;
  }) as Deno.Kv["get"];
  return { paused, release };
}

Deno.test("admins: an overlapping addition cannot restore a successfully removed wallet", async () => {
  const h = await harness();
  try {
    await h.deps.admins.add(PLAIN);
    const old = await h.mint(PLAIN, true);
    const admin = await h.mint(ADMIN, true);
    const gate = pauseMembershipRead(h.db.kv);
    const addition = h.req("/api/admin/admins", {
      token: admin,
      method: "POST",
      json: { address: OTHER },
    });
    await gate.paused;
    const removal = await h.req(`/api/admin/admins/${PLAIN}`, {
      token: admin,
      method: "DELETE",
      json: {},
    });
    gate.release();
    assertEquals(removal.status, 200);
    assertEquals((await addition).status, 200);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), false);
    assertEquals(await h.deps.admins.isAdmin(OTHER), true);
    assertEquals((await h.req("/api/admin/admins", { token: old })).status, 401);
    // Normal sign-in uses this authoritative membership result for the new session.
    const fresh = await h.mint(PLAIN, await h.deps.admins.isAdmin(PLAIN));
    assertEquals((await h.req("/api/admin/admins", { token: fresh })).status, 403);
  } finally {
    h.close();
  }
});

Deno.test("admins: overlapping additions preserve both wallets", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const gate = pauseMembershipRead(h.db.kv);
    const first = h.req("/api/admin/admins", {
      token: admin,
      method: "POST",
      json: { address: PLAIN },
    });
    await gate.paused;
    const second = await h.req("/api/admin/admins", {
      token: admin,
      method: "POST",
      json: { address: OTHER },
    });
    gate.release();
    assertEquals(second.status, 200);
    assertEquals((await first).status, 200);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), true);
    assertEquals(await h.deps.admins.isAdmin(OTHER), true);
    assertEquals((await h.deps.admins.list()).length, 3);
  } finally {
    h.close();
  }
});

Deno.test("admins: overlapping removals preserve both revocations", async () => {
  const h = await harness();
  try {
    await h.deps.admins.add(PLAIN);
    await h.deps.admins.add(OTHER);
    const oldA = await h.mint(PLAIN, true);
    const oldB = await h.mint(OTHER, true);
    const admin = await h.mint(ADMIN, true);
    const gate = pauseMembershipRead(h.db.kv);
    const first = h.req(`/api/admin/admins/${PLAIN}`, {
      token: admin,
      method: "DELETE",
      json: {},
    });
    await gate.paused;
    const second = await h.req(`/api/admin/admins/${OTHER}`, {
      token: admin,
      method: "DELETE",
      json: {},
    });
    gate.release();
    assertEquals(second.status, 200);
    assertEquals((await first).status, 200);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), false);
    assertEquals(await h.deps.admins.isAdmin(OTHER), false);
    assertEquals((await h.req("/api/admin/admins", { token: oldA })).status, 401);
    assertEquals((await h.req("/api/admin/admins", { token: oldB })).status, 401);
    assertEquals(await h.deps.admins.list(), [{ address: ADMIN, fixed: true }]);
  } finally {
    h.close();
  }
});

Deno.test("admins: overlapping additions of the same wallet have one winner", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const gate = pauseMembershipRead(h.db.kv);
    const first = h.req("/api/admin/admins", {
      token: admin,
      method: "POST",
      json: { address: PLAIN },
    });
    await gate.paused;
    const second = await h.req("/api/admin/admins", {
      token: admin,
      method: "POST",
      json: { address: PLAIN },
    });
    gate.release();
    assertEquals(second.status, 200);
    assertEquals((await first).status, 409);
    assertEquals((await h.deps.admins.list()).length, 2);
  } finally {
    h.close();
  }
});
