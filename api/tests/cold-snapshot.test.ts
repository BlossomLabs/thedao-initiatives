/**
 * A cold isolate answers the passive page/board request before it has
 * verified the tokens. That snapshot must not say donations are disabled:
 * the browser paints it at once and would unmount the donate widget until
 * the ?refresh=1 answer put it back. Only a token check that actually ran and
 * failed turns donations off.
 */
import { assertEquals } from "@std/assert";
import { harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { TOKENS } from "../config.ts";

type Page = { donationsEnabled: boolean; refreshDue: boolean };
type Board = { flags: { tokensOk: boolean }; cards: { donationsEnabled: boolean }[] };

Deno.test("cold snapshot: donations stay enabled until the token check has run", async () => {
  const h = await harness();
  const rfp = await h.db.initiatives.insert({
    title: "Cold",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  const cold = await j(await h.req(`/api/initiatives/${rfp.slug}`)) as Page;
  assertEquals(cold.donationsEnabled, true);
  assertEquals(cold.refreshDue, true);
  const board = await j(await h.req("/api/board")) as Board;
  assertEquals(board.flags.tokensOk, true);
  assertEquals(board.cards[0].donationsEnabled, true);
  const warm = await j(await h.req(`/api/initiatives/${rfp.slug}?refresh=1`)) as Page;
  assertEquals(warm.donationsEnabled, true);
  assertEquals(warm.refreshDue, false);
  h.close();
});

Deno.test("a token check that ran and verified nothing disables donations", async () => {
  const h = await harness();
  const rfp = await h.db.initiatives.insert({
    title: "Broken",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  for (const sym of Object.keys(TOKENS)) h.script.brokenTokens.add(sym);
  const checked = await j(await h.req(`/api/initiatives/${rfp.slug}?refresh=1`)) as Page;
  assertEquals(checked.donationsEnabled, false);
  const passive = await j(await h.req(`/api/initiatives/${rfp.slug}`)) as Page;
  assertEquals(passive.donationsEnabled, false);
  const board = await j(await h.req("/api/board")) as Board;
  assertEquals(board.flags.tokensOk, false);
  assertEquals(board.cards[0].donationsEnabled, false);
  h.close();
});
