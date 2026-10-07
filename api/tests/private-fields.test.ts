import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { SESSION_REAUTH_SECS } from "../config.ts";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";

const CONTACT = "PRIVATE-CONTACT-REGRESSION";
const FUNDERS = "PRIVATE-FUNDER-REGRESSION";

Deno.test("private fields: stale admin reads and harmless edits cannot bypass the leads gate", async () => {
  const h = await harness();
  try {
    const row = await h.db.initiatives.insert({
      title: "Private-field regression",
      status: "approved",
      proposer: PLAIN,
      contact: CONTACT,
      funders: FUNDERS,
    });
    const stale = await h.mint(ADMIN, true);
    const proposer = await h.mint(PLAIN);
    h.clock.now += SESSION_REAUTH_SECS;
    const readers = [
      `/api/admin/initiatives/${row.id}`,
      `/api/initiatives/${row.slug}`,
      "/api/admin/dashboard",
    ];
    for (const path of readers) {
      const res = await h.req(path, { token: stale });
      assertEquals(res.status, 200, path);
      const body = await res.text();
      assert(!body.includes(CONTACT), path);
      assert(!body.includes(FUNDERS), path);
    }
    for (const path of [`/api/admin/initiatives/${row.id}`, `/api/initiatives/${row.slug}`]) {
      const res = await h.req(path, { token: stale, method: "PATCH", json: {} });
      assertEquals(res.status, 200, path);
      const result = (await j(res)).initiative as Record<string, unknown>;
      assertEquals(Object.hasOwn(result, "contact"), false, path);
      assertEquals(Object.hasOwn(result, "funders"), false, path);
    }
    for (const path of ["/api/admin/leads", `/initiative/${row.slug}-PRIVATE.md`]) {
      const res = await h.req(path, { token: stale });
      assertEquals(res.status, 403, path);
      assertEquals((await j(res)).reauthenticate, true, path);
    }
    for (const json of [{ contact: "changed" }, { funders: "changed" }]) {
      const res = await h.req(`/api/initiatives/${row.slug}`, {
        token: stale,
        method: "PATCH",
        json,
      });
      assertEquals(res.status, 403);
      assertEquals((await j(res)).reauthenticate, true);
      assertEquals(await h.db.initiatives.get(row.id), row);
    }
    // The owner can still read their own private fields with an older session.
    const own = (await j(await h.req(`/api/initiatives/${row.slug}`, { token: proposer })))
      .initiative as Record<string, unknown>;
    assertEquals(own.contact, CONTACT);
    assertEquals(own.funders, FUNDERS);
    const anonymous = await (await h.req(`/api/initiatives/${row.slug}`)).text();
    assert(!anonymous.includes(CONTACT) && !anonymous.includes(FUNDERS));
    assertEquals((await h.req(`/initiative/${row.slug}-PRIVATE.md`)).status, 401);
    const fresh = await h.mint(ADMIN, true);
    for (const path of readers.slice(0, 2)) {
      const body = await (await h.req(path, { token: fresh })).text();
      assertStringIncludes(body, CONTACT, path);
      assertStringIncludes(body, FUNDERS, path);
    }
    const dashboard = await j(await h.req("/api/admin/dashboard", { token: fresh })) as {
      rows: { initiative: { contact?: string } }[];
    };
    assertEquals(dashboard.rows[0].initiative.contact, CONTACT);
    for (const path of ["/api/admin/leads", `/initiative/${row.slug}-PRIVATE.md`]) {
      const res = await h.req(path, { token: fresh });
      assertEquals(res.status, 200);
      assertStringIncludes(await res.text(), CONTACT);
    }
  } finally {
    h.close();
  }
});

Deno.test("private fields: older proposer can edit their own pending row; other users cannot read it", async () => {
  const h = await harness();
  try {
    const row = await h.db.initiatives.insert({
      title: "Owned pending private fields",
      status: "pending",
      proposer: PLAIN,
      contact: CONTACT,
      funders: FUNDERS,
    });
    const owner = await h.mint(PLAIN);
    const other = await h.mint("0x3333333333333333333333333333333333333333");
    h.clock.now += SESSION_REAUTH_SECS + 1;
    const res = await h.req(`/api/initiatives/${row.slug}`, {
      token: owner,
      method: "PATCH",
      json: { contact: "owner update" },
    });
    assertEquals(res.status, 200);
    assertEquals(((await j(res)).initiative as Record<string, unknown>).contact, "owner update");
    assertEquals((await h.req(`/api/initiatives/${row.slug}`, { token: other })).status, 404);
    assertEquals((await h.req(`/initiative/${row.slug}-PRIVATE.md`, { token: owner })).status, 403);
  } finally {
    h.close();
  }
});

Deno.test("private fields: freshness and proposer ownership are checked again inside the write", async () => {
  for (const transfer of [true, false]) {
    const h = await harness();
    try {
      const row = await h.db.initiatives.insert({
        title: "Concurrent private-field authorization",
        status: "pending",
        proposer: transfer ? ADMIN : PLAIN,
        contact: CONTACT,
        funders: FUNDERS,
      });
      const admin = await h.mint(ADMIN, true);
      if (transfer) h.clock.now += SESSION_REAUTH_SECS;
      const update = h.db.initiatives.update;
      h.db.initiatives.update = async (...args) => {
        h.db.initiatives.update = update;
        if (transfer) await update(row.id, { proposer: PLAIN });
        else h.clock.now += SESSION_REAUTH_SECS;
        return await update(...args);
      };
      const res = await h.req(`/api/initiatives/${row.slug}`, {
        token: admin,
        method: "PATCH",
        json: { contact: "must not be written" },
      });
      assertEquals(res.status, 403);
      assertEquals((await j(res)).reauthenticate, true);
      const after = (await h.db.initiatives.get(row.id))!;
      assertEquals(after.contact, CONTACT);
      assertEquals(after.funders, FUNDERS);
      assertEquals(after.proposer, PLAIN);
    } finally {
      h.close();
    }
  }
});
