/** Goal changes to sign (#149): a ballot initiative's goal request in the round admin's
 * queue, with the exact `setInitiative` call and the Safe batch. */
import { assertEquals } from "@std/assert";
import { decodeFunctionData } from "viem";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { fakeChain, NOW, roundOf } from "./pledge-chain.ts";
import { goalRequestOf, requestGoal } from "../services/goal-requests.ts";
import { goalBlock } from "../services/round-admin-queue.ts";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";

const SAFE = "0xA000000000000000000000000000000000000001";

type Goal = {
  rfpId: string;
  slug: string;
  title: string;
  fromUsd: number;
  toUsd: number;
  by: string;
  call: { id: string; account: string; goalUsd: string; rfp: boolean; groups: string };
  batch: { transactions: { to: string; data: `0x${string}` }[] };
  configRevision: string | null;
};

async function setup() {
  const h = await harness();
  h.clock.now = NOW;
  const row = await h.db.initiatives.insert({
    title: "ValOS on the ballot",
    summary: "s",
    status: "approved",
    goalUsd: 108_000,
    type: "grant",
  });
  const m: VoteManifest = {
    ...roundOf(["other-one", row.slug]),
    configRevision: "130",
    accounts: ["0x9000000000000000000000000000000000000009", SAFE],
    groups: ["SEAL", "ValOS"],
    projects: [
      { goalUsd: "1", rfp: false, groups: [0] },
      { goalUsd: "108000000000", rfp: false, groups: [1] },
    ],
  };
  h.deps.vote = { chain: fakeChain(m).chain, manifest: m };
  const token = await h.mint(ADMIN, true);
  const goals = async () => {
    const res = await h.req("/api/admin/vote-round/queue", { token });
    assertEquals(res.status, 200, await res.clone().text());
    return (await j(res)).goals as Goal[];
  };
  return { h, m, row, token, goals };
}

Deno.test("the queue lists a goal request with the round's account, RFP flag and groups", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    const [g, ...rest] = await s.goals();
    assertEquals(rest, []);
    assertEquals([g.rfpId, g.slug, g.fromUsd, g.toUsd, g.by], [
      s.row.id,
      s.row.slug,
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
    assertEquals(calls[0].args, [130n]);
    assertEquals(calls[1].args, [1n, SAFE, 78_000_000_000n, false, 2n]);
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

Deno.test("a goal request whose initiative left the round is not listed", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    const m = { ...s.m, slugs: ["other-one", "someone-else"] };
    s.h.deps.vote = { chain: fakeChain(m).chain, manifest: m };
    assertEquals(await s.goals(), []);
  } finally {
    s.h.close();
  }
});

Deno.test("goalBlock: settled, withdrawn or a tier settling stop a goal change", () => {
  const w = [
    { slug: "a", withdrawn: false, settledIn: "S" as const },
    { slug: "b", withdrawn: true, settledIn: null },
    { slug: "c", withdrawn: false, settledIn: null },
  ];
  const s = {
    opensAt: 0,
    firstTallyAt: [1000, 5000, 9000] as [number, number, number],
    initialWindow: 100,
    maxWindows: 1,
  };
  assertEquals(goalBlock("a", w, s, 10), { kind: "settled", tier: "S" });
  assertEquals(goalBlock("b", w, s, 10), { kind: "withdrawn" });
  assertEquals(goalBlock("c", w, s, 10), null);
  assertEquals(goalBlock("c", w, s, 1050), { kind: "settling", until: 1100 });
});

Deno.test("a goal request the round already has is not listed, and is dropped", async () => {
  const s = await setup();
  try {
    await requestGoal(s.h.db, s.m, s.row, 78_000, ADMIN);
    const m = {
      ...s.m,
      projects: [s.m.projects[0], { ...s.m.projects[1], goalUsd: "78000000000" }],
    };
    s.h.deps.vote = { chain: fakeChain(m).chain, manifest: m };
    assertEquals(await s.goals(), []);
    assertEquals(await goalRequestOf(s.h.db, m, s.row.id), null);
  } finally {
    s.h.close();
  }
});
