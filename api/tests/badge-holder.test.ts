/** The ETHSecurity Badge holder flag on /api/auth/me: the same check behind the EXPERT role. */
import { assertEquals } from "@std/assert";
import { harness, j, PLAIN } from "./app-helpers.ts";

Deno.test("auth/me: isBadgeHolder follows the badge check behind the EXPERT role", async () => {
  const h = await harness();
  const holder = "0x2222222222222222222222222222222222222222";
  h.script.badgeHolders.add(holder);
  const plain = await h.mint(PLAIN);
  assertEquals((await j(await h.req("/api/auth/me", { token: plain }))).isBadgeHolder, false);
  const badge = await h.mint(holder);
  assertEquals((await j(await h.req("/api/auth/me", { token: badge }))).isBadgeHolder, true);
  h.close();
});

Deno.test("badges: which of the addresses hold the badge, lowercase", async () => {
  const h = await harness();
  const holder = "0x2222222222222222222222222222222222222222";
  h.script.badgeHolders.add(holder);
  const r = await h.req(
    `/api/badges?addresses=${PLAIN},${holder.toUpperCase().replace("0X", "0x")}`,
  );
  assertEquals(r.status, 200);
  assertEquals((await j(r)).holders, [holder]);
  assertEquals((await h.req("/api/badges?addresses=nope")).status, 400);
  assertEquals((await h.req("/api/badges")).status, 400);
  const many = Array.from({ length: 51 }, () => PLAIN).join(",");
  assertEquals((await h.req(`/api/badges?addresses=${many}`)).status, 400);
  h.close();
});
