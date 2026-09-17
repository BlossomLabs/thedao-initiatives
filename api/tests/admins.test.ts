import { assertEquals } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";

const OTHER = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

Deno.test("admins: env addresses are fixed, dashboard changes invalidate existing sessions", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  let plain = await h.mint(PLAIN);
  const list = (token: string) => h.req("/api/admin/admins", { token });

  // Not an admin yet.
  assertEquals((await list(plain)).status, 403);
  let res = await j(await list(admin));
  assertEquals(res.admins, [{ address: ADMIN, fixed: true }]);
  assertEquals(res.you, ADMIN);

  // Add (lowercase input is stored checksummed); dupes and junk are refused.
  res = await j(
    await h.req("/api/admin/admins", {
      method: "POST",
      token: admin,
      json: { address: PLAIN.toLowerCase() },
    }),
  );
  assertEquals(res.admins, [{ address: ADMIN, fixed: true }, { address: PLAIN, fixed: false }]);
  assertEquals(
    (await h.req("/api/admin/admins", { method: "POST", token: admin, json: { address: PLAIN } }))
      .status,
    409,
  );
  assertEquals(
    (await h.req("/api/admin/admins", { method: "POST", token: admin, json: { address: ADMIN } }))
      .status,
    409,
  );
  assertEquals(
    (await h.req("/api/admin/admins", {
      method: "POST",
      token: admin,
      json: { address: "0x1234" },
    })).status,
    400,
  );

  // Promotion invalidates the old session; privilege requires fresh authentication.
  assertEquals((await list(plain)).status, 401);
  plain = await h.mint(PLAIN, true);
  assertEquals((await list(plain)).status, 200);
  assertEquals((await j(await list(plain))).you, PLAIN);

  // Fixed admins cannot be removed here; nobody can remove themselves; unknown is 404.
  let r = await h.req(`/api/admin/admins/${ADMIN}`, { method: "DELETE", token: plain });
  assertEquals(r.status, 400);
  assertEquals((await j(r)).error, "set in ADMIN_ADDRESSES; change the env var to remove it");
  r = await h.req(`/api/admin/admins/${PLAIN}`, { method: "DELETE", token: plain });
  assertEquals(r.status, 400);
  assertEquals((await j(r)).error, "you cannot remove yourself");
  assertEquals(
    (await h.req(`/api/admin/admins/${OTHER}`, { method: "DELETE", token: admin })).status,
    404,
  );

  // Removal by another admin revokes on the next request.
  res = await j(
    await h.req(`/api/admin/admins/${PLAIN.toLowerCase()}`, { method: "DELETE", token: admin }),
  );
  assertEquals(res.admins, [{ address: ADMIN, fixed: true }]);
  assertEquals((await list(plain)).status, 401);
  h.close();
});

Deno.test("admins: a dashboard admin gets the ADMIN role tag and an admin session at sign-in", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  await h.req("/api/admin/admins", { method: "POST", token: admin, json: { address: PLAIN } });
  await h.deps.db.rfps.insert({ title: "Alpha", status: "approved" });
  const rfp = (await h.deps.db.rfps.list(["approved"]))[0];
  const plain = await h.mint(PLAIN, true);
  const posted = await j(
    await h.req(`/api/initiatives/${rfp.slug}/comments`, {
      method: "POST",
      token: plain,
      json: {
        body: "Is this an admin question about the initiative?",
      },
    }),
  ) as { status: string; entry: { roles: string[] } | null };
  assertEquals(posted.status, "published"); // admins skip the AI screen
  assertEquals(posted.entry?.roles.includes("ADMIN"), true);
  h.close();
});
