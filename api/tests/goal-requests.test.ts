/** A ballot initiative's goal change waits for a round admin (#149): the page keeps its
 * goal until the round has the new one, then takes it. */
import { assertEquals } from "@std/assert";
import { ADMIN, type Harness, harness, j } from "./app-helpers.ts";
import { minimalSubmission, revisionBody } from "./fixtures.ts";
import { approved, onBallot, production, setting } from "./ballot-helpers.ts";
import { voteSettingKey } from "../services/vote-active.ts";
import {
  dropGoalRequest,
  goalRequestOf,
  requestGoal,
  settleGoalRequest,
  settleIfOnChain,
} from "../services/goal-requests.ts";

const GOOD = minimalSubmission(25000);
const goalOf = async (h: Harness, slug: string, token?: string) =>
  (await j(await h.req(`/api/initiatives/${slug}`, token ? { token } : {}))).goalRequest as
    | { goalUsd: number; by?: string; at: number }
    | undefined;

Deno.test("admin PATCH goal on the ballot: 202, the page keeps its goal", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug, patch, row, admin } = await onBallot(h);
    const res = await patch({ goal: 78000, durationMonths: 12 });
    assertEquals(res.status, 202);
    assertEquals(((await j(res)).goalRequest as { goalUsd: number }).goalUsd, 78000);
    assertEquals([(await row()).goalUsd, (await row()).durationMonths], [25000, 12]);
    assertEquals((await goalOf(h, slug, admin))?.goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("admin PATCH back to the current goal drops the request", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    assertEquals((await x.patch({ goal: 78000 })).status, 202);
    assertEquals((await x.patch({ goal: 25000 })).status, 200);
    assertEquals(await goalOf(h, x.slug), undefined);
  } finally {
    h.close();
  }
});

Deno.test("off the ballot a goal edit applies as before", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const y = await approved(h);
    assertEquals((await y.patch({ goal: 78000 })).status, 200);
    assertEquals((await y.row()).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("an admin's live text edit with a new goal: the text goes live, the goal is requested", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const body = { ...revisionBody(minimalSubmission(78000)), title: "A retitled initiative" };
    assertEquals((await x.edit({ ...body, goal: 78000 }, x.admin)).status, 201);
    assertEquals([(await x.row()).title, (await x.row()).goalUsd], [
      "A retitled initiative",
      25000,
    ]);
    assertEquals((await goalOf(h, x.slug))?.goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("accepting a proposer's held goal edit: text live, goal requested, its revision sets none", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await x.edit({
      ...revisionBody(minimalSubmission(78000)),
      title: "A retitled initiative",
      goal: 78000,
    });
    assertEquals(held.status, 201);
    const res = await x.accept(((await j(held)).revision as { n: number }).n);
    assertEquals(res.status, 200);
    const live = (await j(res)).revision as { n: number };
    assertEquals((await h.db.revisions.get(x.id, live.n))?.goalUsd, undefined);
    assertEquals([(await x.row()).title, (await x.row()).goalUsd], [
      "A retitled initiative",
      25000,
    ]);
    assertEquals((await goalOf(h, x.slug))?.goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("accepting a held edit without a goal change on the ballot asks for nothing", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await j(
      await x.edit({ ...revisionBody(GOOD), title: "A retitled initiative", goal: 25000 }),
    );
    assertEquals((await x.accept((held.revision as { n: number }).n)).status, 200);
    assertEquals(await goalOf(h, x.slug), undefined);
  } finally {
    h.close();
  }
});

Deno.test("an admin's goal-only edit answers 202 with the request, not Nothing changed", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const body = { ...revisionBody(minimalSubmission(78000)), goal: 78000 };
    const held = await j(await x.edit(body));
    assertEquals((await x.accept((held.revision as { n: number }).n)).status, 200);
    await dropGoalRequest(h.db, x.id);
    const res = await x.edit(body, x.admin);
    assertEquals(res.status, 202, await res.clone().text());
    assertEquals(((await j(res)).goalRequest as { goalUsd: number }).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("after the vote closes a goal change on the ballot is refused", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h, { closesAt: 1 });
    const res = await x.patch({ goal: 78000 });
    assertEquals(res.status, 409);
    assertEquals((await j(res)).error, "The vote has closed: the round's goal is final.");
    assertEquals((await x.row()).goalUsd, 25000);
  } finally {
    h.close();
  }
});

Deno.test("public page data shows a waiting goal without who asked; admins see it", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    assertEquals((await x.patch({ goal: 78000 })).status, 202);
    const anon = (await goalOf(h, x.slug))!;
    assertEquals(anon, { goalUsd: 78000, at: anon.at });
    assertEquals((await goalOf(h, x.slug, x.admin))?.by, ADMIN);
  } finally {
    h.close();
  }
});

Deno.test("the page takes the goal once the round has it, and the request goes", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    assertEquals((await x.patch({ goal: 78000 })).status, 202);
    // The round admin signed: the stored round now has $78,000 for the slot.
    await x.putOnBallot({
      projects: [
        { goalUsd: "1000000", rfp: true, groups: [] },
        { goalUsd: "78000000000", rfp: true, groups: [] },
      ],
    });
    const page = await j(await h.req(`/api/initiatives/${x.slug}`));
    assertEquals(page.goalRequest, undefined);
    assertEquals((page.initiative as { goalUsd: number }).goalUsd, 78000);
    assertEquals((await x.row()).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("settling never removes a request asked for after it was read", async () => {
  const h = await harness();
  try {
    const x = await approved(h);
    const m = production([(await x.row()).safeAddress]);
    await h.db.meta.set(voteSettingKey("production"), setting(m));
    const old = (await requestGoal(h.db, m, await x.row(), 78_000, "0x1"))!;
    h.clock.now += 60;
    await requestGoal(h.db, m, await x.row(), 60_000, "0x2");
    assertEquals(await settleGoalRequest(h.db, old), false);
    assertEquals((await goalRequestOf(h.db, m, x.id))?.goalUsd, 60_000);
  } finally {
    h.close();
  }
});

const signedOnRound = (x: Awaited<ReturnType<typeof onBallot>>) =>
  x.putOnBallot({
    projects: [
      { goalUsd: "1000000", rfp: true, groups: [] },
      { goalUsd: "78000000000", rfp: true, groups: [] },
    ],
  });

Deno.test("settling on a page read never fails the read: a failed write leaves the request", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    assertEquals((await x.patch({ goal: 78000 })).status, 202);
    await signedOnRound(x);
    const update = h.db.initiatives.update;
    h.db.initiatives.update = () => Promise.reject(new Error("update conflict"));
    const res = await h.req(`/api/initiatives/${x.slug}`);
    h.db.initiatives.update = update;
    assertEquals(res.status, 200);
    assertEquals(((await j(res)).goalRequest as { goalUsd: number }).goalUsd, 78000);
    assertEquals((await x.row()).goalUsd, 25000);
  } finally {
    h.close();
  }
});

Deno.test("during maintenance a page read settles nothing", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    assertEquals((await x.patch({ goal: 78000 })).status, 202);
    await signedOnRound(x);
    h.deps.maintenance.on = () => Promise.resolve(true);
    const res = await h.req(`/api/initiatives/${x.slug}`);
    assertEquals(res.status, 200);
    assertEquals((await x.row()).goalUsd, 25000);
    assertEquals(((await j(res)).goalRequest as { goalUsd: number }).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("after the vote closes a held edit carrying a goal still goes live, without the goal", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await j(
      await x.edit({
        ...revisionBody(minimalSubmission(78000)),
        title: "A retitled initiative",
        goal: 78000,
      }),
    );
    await x.putOnBallot({ closesAt: 1 });
    const res = await x.accept((held.revision as { n: number }).n);
    assertEquals(res.status, 200);
    assertEquals([(await x.row()).title, (await x.row()).goalUsd], [
      "A retitled initiative",
      25000,
    ]);
    assertEquals(await goalOf(h, x.slug), undefined);
  } finally {
    h.close();
  }
});

Deno.test("a settled or withdrawn ballot initiative's goal can't be asked for", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    h.deps.ballotStanding = () =>
      Promise.resolve([{ withdrawn: false, settledIn: null }, {
        withdrawn: false,
        settledIn: "A",
      }]);
    const res = await x.patch({ goal: 78000 });
    assertEquals(res.status, 409);
    assertEquals((await j(res)).error, "Settled in A-Tier: its award is final, so its goal stays.");
    h.deps.ballotStanding = () =>
      Promise.resolve([{ withdrawn: false, settledIn: null }, {
        withdrawn: true,
        settledIn: null,
      }]);
    const again = await x.patch({ goal: 78000 });
    assertEquals(again.status, 409);
    assertEquals(
      (await j(again)).error,
      "Withdrawn from the vote: undo the withdrawal to change its goal.",
    );
    assertEquals(await goalOf(h, x.slug), undefined);
  } finally {
    h.close();
  }
});

Deno.test("accepting a held goal edit for a settled initiative puts the text live, without the goal", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await j(
      await x.edit({
        ...revisionBody(minimalSubmission(78000)),
        title: "A retitled initiative",
        goal: 78000,
      }),
    );
    h.deps.ballotStanding = () =>
      Promise.resolve([{ withdrawn: false, settledIn: null }, {
        withdrawn: false,
        settledIn: "S",
      }]);
    assertEquals((await x.accept((held.revision as { n: number }).n)).status, 200);
    assertEquals((await x.row()).title, "A retitled initiative");
    assertEquals(await goalOf(h, x.slug), undefined);
  } finally {
    h.close();
  }
});

Deno.test("accepting a held edit whose goal the page already has keeps another waiting request", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    // A held edit asked for $25,000 when the page had another goal; it has $25,000 now.
    await h.db.initiatives.update(x.id, { goalUsd: 20_000 });
    const held = await j(
      await x.edit({ ...revisionBody(minimalSubmission(25000)), title: "Retitled", goal: 25000 }),
    );
    await h.db.initiatives.update(x.id, { goalUsd: 25_000 });
    assertEquals((await x.patch({ goal: 78000 })).status, 202);
    assertEquals((await x.accept((held.revision as { n: number }).n)).status, 200);
    assertEquals((await goalOf(h, x.slug))?.goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("if the goal request can't be saved, the held edit stays waiting to be accepted again", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await j(
      await x.edit({
        ...revisionBody(minimalSubmission(78000)),
        title: "A retitled initiative",
        goal: 78000,
      }),
    );
    const n = (held.revision as { n: number }).n;
    const set = h.db.kv.set.bind(h.db.kv);
    h.db.kv.set = ((key: Deno.KvKey, value: unknown) =>
      key[0] === "goal-request"
        ? Promise.reject(new Error("KV write failed"))
        : set(key, value)) as typeof h.db.kv.set;
    const res = await x.accept(n);
    h.db.kv.set = set;
    assertEquals(res.status >= 500, true);
    assertEquals([(await x.row()).pendingRevision, (await x.row()).title], [
      n,
      "A proper initiative title",
    ]);
    assertEquals((await x.accept(n)).status, 200);
    assertEquals((await goalOf(h, x.slug))?.goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("if accepting fails after the request was saved, no stray request is left", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await j(
      await x.edit({ ...revisionBody(minimalSubmission(78000)), goal: 78000 }),
    );
    const review = h.db.initiatives.review;
    h.db.initiatives.review = () => Promise.resolve(null);
    assertEquals((await x.accept((held.revision as { n: number }).n)).status, 409);
    h.db.initiatives.review = review;
    assertEquals(await goalOf(h, x.slug), undefined);
  } finally {
    h.close();
  }
});

Deno.test("settling a request that was replaced meanwhile returns the newer one", async () => {
  const h = await harness();
  try {
    const x = await approved(h);
    const m = production([(await x.row()).safeAddress], {
      projects: [{ goalUsd: "78000000000", rfp: true, groups: [] }],
    });
    await h.db.meta.set(voteSettingKey("production"), setting(m));
    const old = (await requestGoal(h.db, m, await x.row(), 78_000, "0x1"))!;
    h.clock.now += 60;
    await requestGoal(h.db, m, await x.row(), 60_000, "0x2");
    const out = await settleIfOnChain(h.db, m, await x.row(), old);
    assertEquals(out.request?.goalUsd, 60_000);
  } finally {
    h.close();
  }
});

Deno.test("accepting an edit that isn't waiting leaves another goal request as it was", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    const held = await j(
      await x.edit({ ...revisionBody(minimalSubmission(78000)), goal: 78000 }),
    );
    const n = (held.revision as { n: number }).n;
    assertEquals((await x.accept(n)).status, 200);
    // A newer request, then the same (no longer waiting) edit accepted again.
    assertEquals((await x.patch({ goal: 60000 })).status, 202);
    assertEquals((await x.accept(n)).status, 409);
    assertEquals((await goalOf(h, x.slug))?.goalUsd, 60000);
  } finally {
    h.close();
  }
});

Deno.test("a failed accept puts back the request that was waiting before it", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await onBallot(h);
    assertEquals((await x.patch({ goal: 60000 })).status, 202);
    const held = await j(
      await x.edit({ ...revisionBody(minimalSubmission(78000)), goal: 78000 }),
    );
    const review = h.db.initiatives.review;
    h.db.initiatives.review = () => Promise.reject(new Error("update conflict"));
    const res = await x.accept((held.revision as { n: number }).n);
    h.db.initiatives.review = review;
    assertEquals(res.status >= 500, true);
    assertEquals((await goalOf(h, x.slug))?.goalUsd, 60000);
  } finally {
    h.close();
  }
});
