/** The round the site runs: the built-in one, or the test round an admin set, with the pool note. */
import { assert, assertEquals } from "@std/assert";
import { createActiveVote, type VoteRoundSetting } from "../services/vote-active.ts";
import type { VoteRound } from "../services/vote-chain.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";

const manifest = (contract: `0x${string}`): VoteManifest => ({
  kind: "test",
  chainId: 11155111,
  contract,
  deployBlock: 1,
  opensAt: 0,
  closesAt: 10,
  schedule: { opensAt: 0, firstTallyAt: [5, 6, 7], initialWindow: 1, maxWindows: 1 },
  poolUsd: "1",
  issuer: "0x1000000000000000000000000000000000000002",
  slugs: ["a"],
  projects: [{ goalUsd: "1", rfp: false, groups: [] }],
  groups: [],
  independentTiers: 1,
});
const BUILT = manifest("0x1000000000000000000000000000000000000001");
const TEST = manifest("0x2000000000000000000000000000000000000002");

Deno.test("active vote: the admin's test round replaces the built-in one, re-read every few seconds", async () => {
  let setting: VoteRoundSetting | null = null;
  let reads = 0;
  let now = 0;
  const builds: string[] = [];
  const active = createActiveVote({
    baked: BUILT,
    read: () => (reads++, Promise.resolve(setting)),
    build: (m) => (builds.push(m.contract), { manifest: m } as VoteRound),
    clock: () => now,
  });
  assertEquals((await active())!.manifest.contract, BUILT.contract);
  setting = { test: { manifest: TEST, at: 1, by: "x" }, pool: { eth: 400, sold: false } };
  // Within the few seconds, the copy this isolate has.
  assertEquals((await active())!.manifest.contract, BUILT.contract);
  now = 6_000;
  const r = (await active())!;
  assertEquals(r.manifest.contract, TEST.contract);
  assertEquals(r.manifest.pool, { eth: 400, sold: false });
  // Back to the built-in round: its VoteRound is the one built before (caches kept).
  setting = null;
  active.forget();
  assertEquals((await active())!.manifest.contract, BUILT.contract);
  assertEquals(builds, [BUILT.contract, TEST.contract]);
  assert(reads >= 3);
});

Deno.test("active vote: none deployed and no test round is no vote", async () => {
  const active = createActiveVote({
    baked: undefined,
    read: () => Promise.resolve(null),
    build: (m) => ({ manifest: m } as VoteRound),
  });
  assertEquals(await active(), undefined);
});

Deno.test("admin vote round: the pool note is admins' only, checked, and can be cleared", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const pool = (json: unknown, token = admin) =>
    h.req("/api/admin/vote-round/pool", { method: "POST", token, json });
  assertEquals((await pool({ eth: 400, sold: false }, await h.mint(PLAIN))).status, 403);
  for (const bad of [{ eth: -1, sold: false }, { eth: "lots", sold: false }, { eth: 400 }]) {
    assertEquals((await pool(bad)).status, 400);
  }
  const saved = await pool({ eth: 400, sold: false });
  assertEquals(saved.status, 200);
  assertEquals(((await j(saved)) as { pool: unknown }).pool, { eth: 400, sold: false });
  const got = await h.req("/api/admin/vote-round", { token: admin });
  assertEquals(((await j(got)) as { pool: unknown; test: unknown }).pool, {
    eth: 400,
    sold: false,
  });
  const cleared = await pool({ eth: null, sold: false });
  assertEquals(((await j(cleared)) as { pool: unknown }).pool, null);
  // A test round needs two addresses before anything is read from the chain.
  const test = await h.req("/api/admin/vote-round/test", {
    method: "POST",
    token: admin,
    json: { contract: "nope", issuer: TEST.issuer },
  });
  assertEquals(test.status, 400);
  h.close();
});
