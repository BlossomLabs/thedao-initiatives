import { assert, assertEquals, assertThrows } from "@std/assert";
import { encodeBallot } from "../shared/vote/ballot.ts";
import type { VoteManifest } from "../shared/vote/manifest.ts";
import { checkBallot } from "../shared/vote/rules.ts";
import { rulesRound } from "../shared/vote/manifest.ts";
import {
  drawBallot,
  keptFor,
  reviseBallot,
  revisionsPlan,
  rng,
  timeline,
  voterKey,
  windows,
} from "./vote-sim.ts";
import { bytesToHex } from "viem";

const slugs = Array.from({ length: 12 }, (_, i) => `p${i}`);
const m: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: 1000,
  closesAt: 6000,
  schedule: { opensAt: 1000, firstTallyAt: [3000, 3700, 4400], initialWindow: 320, maxWindows: 4 },
  poolUsd: "300000000",
  slugs,
  // Two affiliations: p0–p3 share group 0, p4–p5 group 1, the rest none.
  projects: slugs.map((_, i) => ({
    goalUsd: "100000000",
    rfp: false,
    groups: i < 4 ? [0] : i < 6 ? [1] : [],
  })),
  groups: ["Argot", "EF"],
  independentTiers: 1,
};
const asks = slugs.map(() => 100_000_000n);
const pool = 300_000_000n;

Deno.test("revisionsPlan: 40x2,10x3,3x5 over 100 voters", () => {
  const p = revisionsPlan("40x2,10x3,3x5", 100);
  assertEquals(p.filter((n) => n === 2).length, 40);
  assertEquals(p.filter((n) => n === 3).length, 10);
  assertEquals(p.filter((n) => n === 5).length, 3);
  assertEquals(p.filter((n) => n === 0).length, 47);
  assertThrows(() => revisionsPlan("200x1", 100), Error, "more than");
  assertThrows(() => revisionsPlan("lots", 100), Error, "isn't");
});

Deno.test("timeline: first ballots paced before the S-Tier first tally, changes in every window", () => {
  const plan = revisionsPlan("40x2,10x3,3x5", 100);
  const ev = timeline(m, plan, rng("t"), 1100);
  const first = ev.filter((e) => e.kind === "first");
  const revise = ev.filter((e) => e.kind === "revise");
  assertEquals(first.length, 100);
  assertEquals(revise.length, 125);
  for (const e of first) assert(e.at >= 1100 && e.at < 2940, String(e.at));
  // Slowly: no two first ballots more than ~2 steps apart or in the same second twice over.
  const gaps = first.slice(1).map((e, i) => e.at - first[i].at);
  assert(Math.max(...gaps) <= 2 * (1840 / 100) + 1, String(Math.max(...gaps)));
  // Each voter revises as many times as planned.
  for (const [voter, n] of plan.entries()) {
    assertEquals(revise.filter((e) => e.voter === voter).length, n);
  }
  // Every window of every tier gets some, the long ones more; none in a window's last 5 s.
  const ws = windows(m.schedule);
  const inW = ws.map((w) => revise.filter((e) => e.at >= w.start && e.at < w.end - 5).length);
  assertEquals(inW.reduce((a, b) => a + b, 0), 125);
  assert(inW.every((n) => n > 0), inW.join(","));
  assert(inW[0] > inW[3], inW.join(","));
  // The same seed, the same run.
  assertEquals(timeline(m, plan, rng("t"), 1100), ev);
});

Deno.test("windows: each tier's windows from its first tally, halving", () => {
  const ws = windows(m.schedule);
  assertEquals(ws.length, 12);
  assertEquals(ws.slice(0, 4).map((w) => [w.tier, w.start, w.end]), [
    ["S", 3000, 3320],
    ["S", 3320, 3480],
    ["S", 3480, 3560],
    ["S", 3560, 3600],
  ]);
  assertEquals(ws[4].start, 3700);
});

Deno.test("drawBallot: every draw passes the ballot rules", () => {
  const r = rng("rules");
  const round = rulesRound(m, asks, pool);
  for (let k = 0; k < 50; k++) {
    const b = drawBallot(m, asks, pool, r);
    assert(b, "a ballot");
    assert(checkBallot(encodeBallot(slugs, b), round).ok);
  }
});

Deno.test("drawBallot: withdrawn projects are never drawn, and the rules count them at $0", () => {
  const r = rng("withdrawn");
  const round = rulesRound(m, asks, pool, [0]);
  for (let k = 0; k < 20; k++) {
    const b = drawBallot(m, asks, pool, r, {}, [0]);
    assert(b, "a ballot");
    assertEquals(b[slugs[0]], undefined);
    assert(checkBallot(encodeBallot(slugs, b), round).ok);
  }
});

Deno.test("drawBallot: a revision keeps the settled tier's projects where they are", () => {
  const r = rng("keep");
  const first = drawBallot(m, asks, pool, r)!;
  const kept = keptFor(m, bytesToHex(encodeBallot(slugs, first)), 1);
  assert(Object.values(kept).every((t) => t === "S"));
  const next = drawBallot(m, asks, pool, r, kept)!;
  for (const [slug, t] of Object.entries(kept)) assertEquals(next[slug], t);
  assert(!Object.entries(next).some(([slug, t]) => t === "S" && !kept[slug]));
  // Every tier settled: nothing left to change.
  const all = keptFor(m, bytesToHex(encodeBallot(slugs, next)), 3);
  assertEquals(drawBallot(m, asks, pool, r, all), null);
});

Deno.test("reviseBallot: a small edit to the ballot that counts, within the rules", () => {
  const r = rng("revise");
  const round = rulesRound(m, asks, pool);
  for (let k = 0; k < 30; k++) {
    const first = drawBallot(m, asks, pool, r)!;
    const next = reviseBallot(m, asks, pool, r, first)!;
    assert(checkBallot(encodeBallot(slugs, next), round).ok);
    const changed = slugs.filter((s) => first[s] !== next[s]);
    assert(changed.length >= 1 && changed.length <= 2, `${changed.length} changed`);
  }
  // A settled S-Tier stays as it was.
  const first = drawBallot(m, asks, pool, r)!;
  const kept = keptFor(m, bytesToHex(encodeBallot(slugs, first)), 1);
  for (let k = 0; k < 20; k++) {
    const next = reviseBallot(m, asks, pool, r, first, kept)!;
    for (const s of slugs) assertEquals(next[s] === "S", first[s] === "S");
  }
});

Deno.test("voterKey: one key per voter, the same for the same seed", () => {
  assertEquals(voterKey("s", 1), voterKey("s", 1));
  assert(voterKey("s", 1) !== voterKey("s", 2));
  assert(voterKey("s", 1) !== voterKey("t", 1));
});
