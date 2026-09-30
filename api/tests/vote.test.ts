/** Vote eligibility: the settings admins keep (no deploy) and the rule the board and pages share. */
import { assertEquals } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { DEFAULT_VOTE, voteState } from "../../shared/vote.ts";

Deno.test("vote settings: off by default, admins change them, the board and site settings carry them", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const admin = await h.mint(ADMIN, true);
  const board = async () =>
    ((await j(await h.req("/api/board"))) as { flags: { vote: unknown } }).flags.vote;
  const site = async () =>
    ((await j(await h.req("/api/board/settings"))) as { vote: unknown }).vote;
  assertEquals(await board(), { show: false, floorPct: 25, capUsd: 200_000 });
  const save = (json: unknown, token = admin) =>
    h.req("/api/admin/vote-settings", { method: "POST", token, json });
  assertEquals(
    (await save({ show: true, floorPct: 30, capUsd: 1 }, await h.mint(PLAIN))).status,
    403,
  );
  for (
    const bad of [
      { show: "yes", floorPct: 25, capUsd: 1 },
      { show: true, floorPct: 120, capUsd: 1 },
      { show: true, floorPct: 25, capUsd: -1 },
    ]
  ) assertEquals((await save(bad)).status, 400);
  assertEquals((await save({ show: true, floorPct: 30, capUsd: 150_000 })).status, 200);
  assertEquals(await board(), { show: true, floorPct: 30, capUsd: 150_000 });
  assertEquals(await site(), { show: true, floorPct: 30, capUsd: 150_000 });
  h.close();
});

Deno.test("voteState: below the floor, eligible, eligible with a gap above the cap", () => {
  const s = { ...DEFAULT_VOTE, show: true };
  assertEquals(voteState(100_000, 600_000, s), { kind: "below", toFloorUsd: 50_000 });
  assertEquals(voteState(151_008, 279_000, s), { kind: "eligible" });
  assertEquals(voteState(150_000, 600_000, s), { kind: "gap", gapUsd: 450_000, capUsd: 200_000 });
});

Deno.test("the board marks each card's vote state only while the display is on", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const admin = await h.mint(ADMIN, true);
  await h.db.initiatives.insert({ title: "T", summary: "s", status: "approved", goalUsd: 1000 });
  const vote = async () =>
    ((await j(await h.req("/api/board"))) as { cards: { vote?: string }[] }).cards[0].vote;
  assertEquals(await vote(), undefined);
  await h.req("/api/admin/vote-settings", {
    method: "POST",
    token: admin,
    json: { show: true, floorPct: 25, capUsd: 200_000 },
  });
  assertEquals(await vote(), "below");
  h.close();
});
