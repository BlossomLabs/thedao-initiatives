/** Goal changes to sign (#149): each ballot initiative with a goal request, and each whose
 * site goal differs from the round's, with the exact setInitiative call and a Safe batch. */
import { assertEquals } from "@std/assert";
import { decodeFunctionData } from "viem";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { fakeChain, NOW, roundOf } from "./pledge-chain.ts";
import { goalRequestOf, requestGoal } from "../services/goal-requests.ts";
import { goalBlock, roundAdminQueue } from "../services/round-admin-queue.ts";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";

const SAFE = "0xA000000000000000000000000000000000000001";
const OTHER = "0x9000000000000000000000000000000000000009";

type Goal = {
  kind: "request" | "record";
  rfpId: string;
  slug: string;
  fromUsd: number;
  toUsd: number;
  by: string | null;
  call: { id: string; account: string; goalUsd: string; rfp: boolean; groups: string };
  batch: { transactions: { to: string; data: `0x${string}` }[] };
  configRevision: string | null;
};

async function setup(siteGoal = 108_000, roundGoal = "108000000000") {
  const h = await harness();
  h.clock.now = NOW;
  const row = await h.db.initiatives.insert({
    title: "ValOS on the ballot",
    summary: "s",
    status: "approved",
    goalUsd: siteGoal,
    type: "grant",
    safeAddress: SAFE,
  });
  const round = (goal = roundGoal): VoteManifest => ({
    ...roundOf(["other-one", "listed-under-another-slug"]),
    configRevision: "130",
    accounts: [OTHER, SAFE],
    groups: ["SEAL", "ValOS"],
    projects: [
      { goalUsd: "1", rfp: false, groups: [0] },
      { goalUsd: goal, rfp: false, groups: [1] },
    ],
  });
  const use = (m: VoteManifest) => (h.deps.vote = { chain: fakeChain(m).chain, manifest: m });
  const m = round();
  use(m);
  const token = await h.mint(ADMIN, true);
  const goals = async () => {
    const res = await h.req("/api/admin/vote-round/queue", { token });
    assertEquals(res.status, 200, await res.clone().text());
    return (await j(res)).goals as Goal[];
  };
  return { h, m, round, use, row, token, goals };
}

Deno.test("a goal request is listed with the round's account, RFP flag and groups", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    const [g, ...rest] = await s.goals();
    assertEquals(rest, []);
    assertEquals([g.kind, g.rfpId, g.fromUsd, g.toUsd, g.by], [
      "request",
      s.row.id,
      108_000,
      78_000,
      ADMIN,
    ]);
    assertEquals(g.call, {
      id: "1",
      account: SAFE,
      goalUsd: "78000000000",
      rfp: false,
      groups: "2",
    });
    assertEquals(g.configRevision, "130");
    const calls = g.batch.transactions.map((t) =>
      decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: t.data })
    );
    assertEquals(calls.map((c) => c.functionName), ["requireConfigRevision", "setInitiative"]);
    assertEquals(calls[1].args, [1n, SAFE, 78_000_000_000n, false, 2n]);
  } finally {
    s.h.close();
  }
});

Deno.test("a request the round has is settled: the page takes the goal and it isn't listed", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    s.use(s.round("78000000000"));
    assertEquals(await s.goals(), []);
    assertEquals((await s.h.db.initiatives.get(s.row.id))!.goalUsd, 78_000);
    assertEquals(await goalRequestOf(s.h.db, s.m, s.row.id), null);
  } finally {
    s.h.close();
  }
});

Deno.test("a site goal the round doesn't have is listed as a record item", async () => {
  const s = await setup(78_000, "108000000000");
  try {
    const [g, ...rest] = await s.goals();
    assertEquals(rest, []);
    assertEquals([g.kind, g.fromUsd, g.toUsd, g.by, g.call.goalUsd], [
      "record",
      108_000,
      78_000,
      null,
      "78000000000",
    ]);
  } finally {
    s.h.close();
  }
});

Deno.test("a ballot initiative whose goals agree is not listed", async () => {
  const s = await setup(108_000, "108000000000");
  try {
    assertEquals(await s.goals(), []);
  } finally {
    s.h.close();
  }
});

Deno.test("discard drops a goal request", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    const res = await s.h.req(`/api/admin/initiatives/${s.row.id}/goal-request`, {
      method: "DELETE",
      token: s.token,
    });
    assertEquals(res.status, 200);
    assertEquals(await s.goals(), []);
  } finally {
    s.h.close();
  }
});

Deno.test("goalBlock reads the slot, not the slug: settled, withdrawn, settling, unknown", () => {
  // The replay's list is in the round's slot order, under the slugs the round had.
  const w = [
    { slug: "old-name", withdrawn: false, settledIn: "S" as const },
    { slug: "b", withdrawn: true, settledIn: null },
    { slug: "c", withdrawn: false, settledIn: null },
  ];
  const s = {
    opensAt: 0,
    firstTallyAt: [1000, 5000, 9000] as [number, number, number],
    initialWindow: 100,
    maxWindows: 1,
  };
  assertEquals(goalBlock(0, w, s, 10), { kind: "settled", tier: "S" });
  assertEquals(goalBlock(1, w, s, 10), { kind: "withdrawn" });
  assertEquals(goalBlock(2, w, s, 10), null);
  assertEquals(goalBlock(2, w, s, 1050), { kind: "settling", until: 1100 });
  assertEquals(goalBlock(2, null, s, 10), { kind: "unknown" });
  assertEquals(goalBlock(5, w, s, 10), { kind: "unknown" });
});

Deno.test("the queue service never offers a goal change as signable before the route checks it", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    const q = await roundAdminQueue(s.h.deps).queue({ manifest: s.m } as never);
    assertEquals(q.goals.map((g) => g.blocked), [{ kind: "unknown" }]);
  } finally {
    s.h.close();
  }
});
