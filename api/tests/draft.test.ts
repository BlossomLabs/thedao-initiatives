import { assert, assertEquals } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { AUTOSAVE_TTL_SECS } from "../../shared/draft/autosave.ts";
Deno.test("private drafts: authentication, ownership, atomic large writes and deletion tombstones", async () => {
  const h = await harness();
  try {
    const token = await h.mint(PLAIN), other = await h.mint(ADMIN, true);
    const path = "/api/draft/" + PLAIN;
    assertEquals((await h.req(path)).status, 401);
    assertEquals((await h.req(path, { token: other })).status, 403);
    const read = await h.req(path, { token });
    assertEquals(read.headers.get("Cache-Control"), "no-store");
    assertEquals(await j(read), { version: null, data: null });
    const data = { priv: { contact: "private@example.test" }, unsorted: "é".repeat(100_000) };
    const saved = await j(
      await h.req(path, { token, method: "PUT", json: { version: null, data } }),
    );
    assert(saved.version);
    assertEquals((await j(await h.req(path, { token }))).data, data);
    assertEquals(
      (await h.req(path, { token: other, method: "PUT", json: { version: saved.version, data } }))
        .status,
      403,
    );
    assertEquals(
      (await h.req(path, {
        token,
        method: "PUT",
        json: { version: null, data: { unsorted: "stale" } },
      })).status,
      409,
    );
    assertEquals(
      (await h.req(path, { token, method: "DELETE", json: { version: saved.version } })).status,
      200,
    );
    assertEquals(
      (await h.req(path, { token, method: "PUT", json: { version: saved.version, data } })).status,
      409,
    );
    assertEquals((await j(await h.req(path, { token }))).data, null);
  } finally {
    h.close();
  }
});
Deno.test("private drafts: bounds, expiry and backup exclusion", async () => {
  const h = await harness();
  try {
    const token = await h.mint(PLAIN), admin = await h.mint(ADMIN, true);
    const path = "/api/draft/" + PLAIN;
    assertEquals(
      (await h.req(path, {
        token,
        method: "PUT",
        json: { version: null, data: { unsorted: "é".repeat(140_000) } },
      })).status,
      413,
    );
    assertEquals(
      (await h.req(path, {
        token,
        method: "PUT",
        json: { version: null, data: { other: "invalid" } },
      })).status,
      400,
    );
    assertEquals(
      (await h.req(path, {
        token,
        method: "PUT",
        json: { version: null, data: { priv: { contact: "secret" } } },
      })).status,
      200,
    );
    const backup = await j(await h.req("/api/admin/backup", { token: admin }));
    assertEquals(JSON.stringify(backup).includes("secret"), false);
    h.clock.now += AUTOSAVE_TTL_SECS + 1;
    const fresh = await h.mint(PLAIN);
    assertEquals((await j(await h.req(path, { token: fresh }))).data, null);
  } finally {
    h.close();
  }
});
