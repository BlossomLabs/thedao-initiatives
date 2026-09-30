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
