/** The round the site runs: the built-in one, or the test round an admin set, with the pool note. */
import { assert, assertEquals } from "@std/assert";
import {
  createActiveVote,
  VOTE_ROUND_KEY,
  type VoteRoundSetting,
} from "../services/vote-active.ts";
import type { VoteRound } from "../services/vote-chain.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { SESSION_REAUTH_SECS } from "../config.ts";
import { boardRound } from "../routes/board.ts";

const manifest = (contract: `0x${string}`): VoteManifest => ({
  kind: "test",
  chainId: 11155111,
  contract,
  deployBlock: 1,
  opensAt: 0,
  closesAt: 10,
  schedule: { opensAt: 0, firstTallyAt: [5, 6, 7], initialWindow: 1, maxWindows: 1 },
  poolUsd: "1",
  slugs: ["a"],
  projects: [{ goalUsd: "1", rfp: false, groups: [] }],
  groups: [],
  independentTiers: 1,
});
const BUILT = manifest("0x1000000000000000000000000000000000000001");
const TEST = manifest("0x2000000000000000000000000000000000000002");

Deno.test("active vote: the round admins set, re-read every few seconds; none set, no vote", async () => {
  let setting: VoteRoundSetting | null = { round: { manifest: BUILT, at: 1, by: "x" } };
  let reads = 0;
  let now = 0;
  const builds: string[] = [];
  const active = createActiveVote({
    read: () => (reads++, Promise.resolve(setting)),
    build: (m) => (builds.push(m.contract), { manifest: m } as VoteRound),
    clock: () => now,
  });
  assertEquals((await active())!.manifest.contract, BUILT.contract);
  // Set under its earlier name (before real rounds were set this way): still read.
  setting = { test: { manifest: TEST, at: 1, by: "x" }, pool: { eth: 400, sold: false } };
  // Within the few seconds, the copy this isolate has.
  assertEquals((await active())!.manifest.contract, BUILT.contract);
  now = 6_000;
  const r = (await active())!;
  assertEquals(r.manifest.contract, TEST.contract);
  assertEquals(r.manifest.pool, { eth: 400, sold: false });
  // Back to the first round: its VoteRound is the one built before (caches kept).
  setting = { round: { manifest: BUILT, at: 2, by: "x" } };
  active.forget();
  assertEquals((await active())!.manifest.contract, BUILT.contract);
  assertEquals(builds, [BUILT.contract, TEST.contract]);
  setting = null;
  active.forget();
  assertEquals(await active(), undefined);
  assert(reads >= 4);
});

Deno.test("admin vote round: the real vote's round can't change or go while it's open", async () => {
  const h = await harness();
  const NOW = h.clock.now;
  const realRound: VoteManifest = {
    ...BUILT,
    kind: "real",
    chainId: 1,
    badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C",
    opensAt: NOW - 60,
    closesAt: NOW + 3600,
  };
  await h.deps.db.meta.set(VOTE_ROUND_KEY, { round: { manifest: realRound, at: 1, by: "x" } });
  const token = await h.mint(ADMIN, true);
  const swap = await h.req("/api/admin/vote-round/round", {
    method: "POST",
    token,
    json: { contract: TEST.contract, chain: "sepolia" },
  });
  assertEquals(swap.status, 409);
  const off = await h.req("/api/admin/vote-round/round", { method: "DELETE", token, json: {} });
  assertEquals(off.status, 409);
  // The same address on the other network is another contract: refused before any read.
  const otherChain = await h.req("/api/admin/vote-round/round", {
    method: "POST",
    token,
    json: { contract: realRound.contract, chain: "sepolia" },
  });
  assertEquals(otherChain.status, 409);
  // Once it closes, it can go.
  h.clock.now = NOW + 3600;
  const later = await h.req("/api/admin/vote-round/round", {
    method: "DELETE",
    token: await h.mint(ADMIN, true),
    json: {},
  });
  assertEquals(later.status, 200);
  assertEquals(((await j(later)) as { round: unknown }).round, null);
  h.close();
});

Deno.test("active vote: none deployed and no test round is no vote", async () => {
  const active = createActiveVote({
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
  // A test round needs an address before anything is read from the chain.
  const test = await h.req("/api/admin/vote-round/round", {
    method: "POST",
    token: admin,
    json: { contract: "nope", chain: "sepolia" },
  });
  assertEquals(test.status, 400);
  h.close();
});

Deno.test("admin vote round: changes need a recent sign-in", async () => {
  const h = await harness();
  const stale = await h.mint(ADMIN, true);
  h.clock.now += SESSION_REAUTH_SECS;
  for (
    const [method, path, json] of [
      ["POST", "/api/admin/vote-round/pool", { eth: 400, sold: false }],
      ["POST", "/api/admin/vote-round/round", { contract: TEST.contract, chain: "sepolia" }],
      ["DELETE", "/api/admin/vote-round/round", {}],
    ] as const
  ) {
    const res = await h.req(path, { method, token: stale, json });
    assertEquals(res.status, 403, `${method} ${path}`);
    assertEquals(((await j(res)) as { reauthenticate?: boolean }).reauthenticate, true);
  }
  h.close();
});

Deno.test("admin vote round: a failed chain read doesn't show the RPC's URL", async () => {
  const secret = "http://127.0.0.1:9/sepolia/v3/SECRET-KEY";
  const h = await harness({ env: { SEPOLIA_RPC_URL: secret } });
  const logs: string[] = [];
  const log = h.deps.log;
  h.deps.log = (m) => (logs.push(m), log(m));
  const admin = await h.mint(ADMIN, true);
  const res = await h.req("/api/admin/vote-round/round", {
    method: "POST",
    token: admin,
    json: { contract: TEST.contract, chain: "sepolia" },
  });
  const text = await res.text();
  assertEquals(res.status, 502);
  assert(!text.includes("SECRET-KEY"), text);
  h.close();
});

Deno.test("boardRound: what the round is for every board, the whole of it once the real vote opens", () => {
  const brief = boardRound(TEST, 100);
  assertEquals(brief, {
    kind: "test",
    chainId: 11155111,
    contract: TEST.contract,
    opensAt: TEST.opensAt,
    closesAt: TEST.closesAt,
  });
  const real: VoteManifest = { ...BUILT, kind: "real", chainId: 1, opensAt: 50, closesAt: 500 };
  assertEquals("manifest" in boardRound(real, 49)!, false);
  assertEquals(boardRound(real, 50)!.manifest, real);
  assertEquals(boardRound(undefined, 50), null);
});

Deno.test("vote manifest: kept a few seconds by the browser, a 304 when it hasn't changed", async () => {
  const h = await harness();
  await h.deps.db.meta.set(VOTE_ROUND_KEY, { round: { manifest: TEST, at: 1, by: "x" } });
  h.deps.voteRound = createActiveVote({
    read: () => h.deps.db.meta.get(VOTE_ROUND_KEY),
    build: (m) => ({ manifest: m } as VoteRound),
  });
  const first = await h.req("/api/vote/manifest");
  assertEquals(first.status, 200);
  assertEquals(
    first.headers.get("Cache-Control"),
    "private, max-age=10, stale-while-revalidate=60",
  );
  assertEquals(((await j(first)) as { manifest: VoteManifest }).manifest.contract, TEST.contract);
  const etag = first.headers.get("ETag")!;
  const again = await h.req("/api/vote/manifest", { headers: { "If-None-Match": etag } });
  assertEquals(again.status, 304);
  h.close();
});
