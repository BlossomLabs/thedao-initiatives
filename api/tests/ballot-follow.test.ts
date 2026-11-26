/** On the ballot the site follows the round (#149): goal, type and shared affiliations,
 * never the Safe; a goal request settles once the round has its goal. */
import { assertEquals } from "@std/assert";
import { type Harness, harness } from "./app-helpers.ts";
import { NO_ROUND, type VoteManifest } from "../../shared/vote/manifest.ts";
import { followRound, sharedGroups } from "../services/ballot-follow.ts";
import { goalRequestOf, requestGoal, settleGoalRequest } from "../services/goal-requests.ts";

const SAFE_A = "0xA000000000000000000000000000000000000001";
const SAFE_B = "0xB000000000000000000000000000000000000002";
const SAFE_C = "0xC000000000000000000000000000000000000003";

const round = (slugs: string[], over: Partial<VoteManifest> = {}): VoteManifest => ({
  ...NO_ROUND,
  kind: "real",
  chainId: 1,
  badge: `0x${"34".repeat(20)}`,
  contract: `0x${"12".repeat(20)}`,
  closesAt: 4_000_000_000,
  slugs,
  accounts: [SAFE_A, SAFE_B] as `0x${string}`[],
  groups: ["SEAL", "Foo", "ValOS"],
  projects: [
    { goalUsd: "78000000000", rfp: false, groups: [0, 1, 2] },
    { goalUsd: "50000000000", rfp: false, groups: [0, 1] },
  ],
  ...over,
});

async function rows(h: Harness) {
  const a = await h.db.initiatives.insert({
    title: "Grant A on the ballot",
    goalUsd: 108_000,
    status: "approved",
    type: "grant",
    safeAddress: SAFE_A,
  });
  const b = await h.db.initiatives.insert({
    title: "Grant B on the ballot",
    goalUsd: 50_000,
    status: "approved",
    type: "grant",
    safeAddress: SAFE_B,
  });
  await h.db.initiatives.update(b.id, { affiliations: ["foo", "seal"] });
  return { a: (await h.db.initiatives.get(a.id))!, b: (await h.db.initiatives.get(b.id))! };
}

Deno.test("sharedGroups drops a group only one initiative holds", () => {
  assertEquals(sharedGroups(round(["a", "b"]), 0), ["SEAL", "Foo"]);
});

Deno.test("follows goal, type and shared affiliations; never the Safe", async () => {
  const h = await harness();
  try {
    const { a } = await rows(h);
    await h.db.initiatives.update(a.id, { safeAddress: SAFE_C });
    const m = round([a.slug, "missing"], {
      projects: [{ goalUsd: "78000000000", rfp: true, groups: [] }, round([]).projects[1]],
    });
    const changes = await followRound(h.db, m);
    const after = (await h.db.initiatives.get(a.id))!;
    assertEquals([after.goalUsd, after.type, after.safeAddress], [78_000, "rfp", SAFE_C]);
    assertEquals(changes.map((c: { field: string }) => c.field).sort(), ["goalUsd", "type"]);
  } finally {
    h.close();
  }
});

Deno.test("shared affiliations are copied, a team's own group is not, case and order ignored", async () => {
  const h = await harness();
  try {
    const { a, b } = await rows(h);
    const changes = await followRound(h.db, round([a.slug, b.slug]));
    assertEquals((await h.db.initiatives.get(a.id))!.affiliations, ["SEAL", "Foo"]);
    assertEquals((await h.db.initiatives.get(b.id))!.affiliations, ["foo", "seal"]);
    assertEquals(changes.filter((c) => c.field === "affiliations").map((c) => c.slug), [a.slug]);
  } finally {
    h.close();
  }
});

Deno.test("a test round changes nothing", async () => {
  const h = await harness();
  try {
    const { a } = await rows(h);
    const m = round([a.slug, "x"], { kind: "test", chainId: 11155111, badge: undefined });
    assertEquals(await followRound(h.db, m), []);
    assertEquals((await h.db.initiatives.get(a.id))!.goalUsd, 108_000);
  } finally {
    h.close();
  }
});

Deno.test("rows not in the round are untouched", async () => {
  const h = await harness();
  try {
    const { a, b } = await rows(h);
    await followRound(h.db, round([b.slug, "other"]));
    assertEquals((await h.db.initiatives.get(a.id))!.goalUsd, 108_000);
  } finally {
    h.close();
  }
});

Deno.test("a goal request the round now matches is dropped, another stays", async () => {
  const h = await harness();
  try {
    const { a, b } = await rows(h);
    const m = round([a.slug, b.slug]);
    await requestGoal(h.db, m, a, 78_000, "0x1");
    await requestGoal(h.db, m, b, 60_000, "0x1");
    await followRound(h.db, m);
    assertEquals(await goalRequestOf(h.db, m, a.id), null);
    assertEquals((await goalRequestOf(h.db, m, b.id))?.goalUsd, 60_000);
  } finally {
    h.close();
  }
});

Deno.test("requestGoal: asking for the current goal drops the request", async () => {
  const h = await harness();
  try {
    const { a } = await rows(h);
    const m = round([a.slug, "x"]);
    assertEquals((await requestGoal(h.db, m, a, 78_000, "0x1"))?.goalUsd, 78_000);
    assertEquals(await requestGoal(h.db, m, a, 108_000, "0x1"), null);
    assertEquals(await goalRequestOf(h.db, m, a.id), null);
  } finally {
    h.close();
  }
});

Deno.test("goalRequestOf ignores another round's request", async () => {
  const h = await harness();
  try {
    const { a } = await rows(h);
    await requestGoal(h.db, round([a.slug, "x"]), a, 78_000, "0x1");
    const other = round([a.slug, "x"], { contract: `0x${"56".repeat(20)}` });
    assertEquals(await goalRequestOf(h.db, other, a.id), null);
    assertEquals(await goalRequestOf(h.db, undefined, a.id), null);
  } finally {
    h.close();
  }
});

Deno.test("an affiliation only this initiative holds on the round stays on the site", async () => {
  const h = await harness();
  try {
    const { a, b } = await rows(h);
    await h.db.initiatives.update(a.id, { affiliations: ["seal"] });
    // SEAL is a's alone on this round; Foo is shared with b.
    const m = round([a.slug, b.slug], {
      projects: [
        { goalUsd: "108000000000", rfp: false, groups: [0, 1] },
        { goalUsd: "50000000000", rfp: false, groups: [1] },
      ],
    });
    await followRound(h.db, m);
    assertEquals((await h.db.initiatives.get(a.id))!.affiliations, ["Foo", "seal"]);
    const again = await followRound(h.db, m);
    assertEquals(again, []);
  } finally {
    h.close();
  }
});

Deno.test("settling a request never drops a newer one written since it was read", async () => {
  const h = await harness();
  try {
    const { a } = await rows(h);
    const m = round([a.slug, "x"]);
    const old = (await requestGoal(h.db, m, a, 78_000, "0x1"))!;
    h.clock.now += 60;
    await requestGoal(h.db, m, a, 60_000, "0x2");
    assertEquals(await settleGoalRequest(h.db, old), false);
    assertEquals((await goalRequestOf(h.db, m, a.id))?.goalUsd, 60_000);
    const now = (await goalRequestOf(h.db, m, a.id))!;
    assertEquals(await settleGoalRequest(h.db, now), true);
    assertEquals(await goalRequestOf(h.db, m, a.id), null);
  } finally {
    h.close();
  }
});
