/** Vote eligibility: the settings admins keep (no deploy) and the rule the board and pages share. */
import { assertEquals } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { NO_ROUND, type VoteManifest } from "../../shared/vote/manifest.ts";
import type { VoteRound } from "../services/vote-chain.ts";
import { DEFAULT_VOTE, voteFloorPct, voteState } from "../../shared/vote.ts";

Deno.test("vote settings: off by default, admins change them, the board and site settings carry them", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const admin = await h.mint(ADMIN, true);
  const board = async () =>
    ((await j(await h.req("/api/board"))) as { flags: { vote: unknown } }).flags.vote;
  const site = async () =>
    ((await j(await h.req("/api/board/settings"))) as { vote: unknown }).vote;
  assertEquals(await board(), { show: false, floorPct: 25, capUsd: 200_000, qualifyBy: null });
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
      { show: true, floorPct: 25, capUsd: 1, qualifyBy: "Nov 23" },
    ]
  ) assertEquals((await save(bad)).status, 400);
  assertEquals((await save({ show: true, floorPct: 30, capUsd: 150_000 })).status, 200);
  assertEquals(await board(), { show: true, floorPct: 30, capUsd: 150_000, qualifyBy: null });
  const saved = { show: true, floorPct: 30, capUsd: 150_000, qualifyBy: 1_800_400_000 };
  assertEquals((await save(saved)).status, 200);
  assertEquals(await board(), saved);
  assertEquals(await site(), saved);
  // A body without the key (an older page) keeps the stored deadline; null clears it.
  assertEquals((await save({ show: false, floorPct: 30, capUsd: 150_000 })).status, 200);
  assertEquals(await board(), { ...saved, show: false });
  assertEquals((await save({ ...saved, qualifyBy: null })).status, 200);
  assertEquals(await board(), { ...saved, qualifyBy: null });
  h.close();
});

Deno.test("voteState: below the floor, eligible, and a large goal's floor is the goal less the cap", () => {
  const s = { ...DEFAULT_VOTE, show: true };
  assertEquals(voteState(50_000, 240_000, s), { kind: "below", toFloorUsd: 10_000 });
  assertEquals(voteState(151_008, 279_000, s), { kind: "eligible" });
  // $600k goal: 25% is $150k, but TheDAO tops up $200k at most, so the floor is $400k.
  assertEquals(voteState(150_000, 600_000, s), { kind: "below", toFloorUsd: 250_000 });
  assertEquals(voteState(400_000, 600_000, s), { kind: "eligible" });
  assertEquals(voteFloorPct(240_000, s), 25);
  assertEquals(voteFloorPct(800_000, s), 75);
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

Deno.test("the board marks an initiative on the real round's ballot; a test round marks none", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const admin = await h.mint(ADMIN, true);
  const a = await h.db.initiatives.insert({
    title: "A",
    summary: "s",
    status: "approved",
    goalUsd: 1000,
  });
  await h.req("/api/admin/vote-settings", {
    method: "POST",
    token: admin,
    json: { show: true, floorPct: 25, capUsd: 200_000 },
  });
  const vote = async () =>
    ((await j(await h.req("/api/board"))) as { cards: { vote?: string }[] }).cards[0].vote;
  const manifest = (kind: "real" | "test"): VoteManifest => ({
    ...NO_ROUND,
    kind,
    chainId: kind === "real" ? 1 : 11155111,
    badge: kind === "real" ? "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C" : undefined,
    contract: "0x1000000000000000000000000000000000000001",
    slugs: [a.slug],
    projects: [{ goalUsd: "1", rfp: false, groups: [] }],
  });
  h.deps.vote = { manifest: manifest("test") } as VoteRound;
  assertEquals(await vote(), "below");
  h.deps.vote = { manifest: manifest("real") } as VoteRound;
  assertEquals(await vote(), "ballot");
  h.deps.vote = { manifest: { ...manifest("real"), slugs: ["other"] } } as VoteRound;
  assertEquals(await vote(), "below");
  h.close();
});

Deno.test("after the deadline to qualify, only initiatives on the real ballot stay in the vote", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const admin = await h.mint(ADMIN, true);
  const insert = (title: string, goalUsd: number) =>
    h.db.initiatives.insert({ title, summary: "s", status: "approved", goalUsd });
  const onBallot = await insert("On", 1000);
  const qualified = await insert("Qualified", 1000);
  const below = await insert("Below", 1_000_000);
  await h.db.pledges.add(qualified.id, {
    company: "Acme",
    amountUsd: 500,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const deadline = h.clock.now + 3600;
  const saved = await h.req("/api/admin/vote-settings", {
    method: "POST",
    token: admin,
    json: { show: true, floorPct: 25, capUsd: 200_000, qualifyBy: deadline },
  });
  assertEquals(saved.status, 200, await saved.clone().text());
  const manifest: VoteManifest = {
    ...NO_ROUND,
    kind: "real",
    chainId: 1,
    badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C",
    contract: "0x1000000000000000000000000000000000000001",
    slugs: [onBallot.slug],
    projects: [{ goalUsd: "1", rfp: false, groups: [] }],
  };
  h.deps.vote = { manifest } as VoteRound;
  const votes = async () => {
    const b = (await j(await h.req("/api/board"))) as {
      cards: { vote?: string; initiative: { id: string } }[];
      flags: { vote: { qualifyBy: number | null } };
    };
    assertEquals(b.flags.vote.qualifyBy, deadline);
    const of = (id: string) => b.cards.find((c) => c.initiative.id === id)!.vote;
    return [of(onBallot.id), of(qualified.id), of(below.id)];
  };
  assertEquals(await votes(), ["ballot", "eligible", "below"]);
  h.clock.now = deadline;
  assertEquals(await votes(), ["ballot", "closed", "closed"]);
  // A round that can't be read (an RPC hiccup) closes nothing: its ballot is unknown.
  h.deps.voteRound = () => Promise.reject(new Error("rpc down"));
  assertEquals(await votes(), ["below", "eligible", "below"]);
  // Nor does a test round: the deadline is the real ballot's.
  h.deps.voteRound = () =>
    Promise.resolve({ manifest: { ...manifest, kind: "test" } } as VoteRound);
  assertEquals(await votes(), ["below", "eligible", "below"]);
  h.deps.voteRound = undefined;
  // The feed lists a closed one as Open for funding.
  const feed = (await j(await h.req("/api/initiatives.json"))) as {
    initiatives: { slug: string; status: string }[];
  };
  assertEquals(feed.initiatives.find((x) => x.slug === qualified.slug)?.status, "open");
  h.close();
});
