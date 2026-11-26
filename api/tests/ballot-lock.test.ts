import { assertEquals, assertThrows } from "@std/assert";
import { ADMIN, deploySafe, type Harness, harness, j, proposerToken } from "./app-helpers.ts";
import { grantBody, minimalSubmission, revisionBody, syntheticContentFiles } from "./fixtures.ts";
import { NO_ROUND, type VoteManifest } from "../../shared/vote/manifest.ts";
import { voteSettingKey } from "../services/vote-active.ts";
import { assertOffBallot, ballotSlugs, ON_BALLOT } from "../services/ballot-lock.ts";
import { HttpError } from "../lib/errors.ts";

const test: VoteManifest = { ...NO_ROUND, contract: `0x${"12".repeat(20)}`, slugs: ["t"] };
const production: VoteManifest = {
  ...test,
  kind: "real",
  chainId: 1,
  badge: `0x${"34".repeat(20)}`,
  slugs: ["a", "b"],
  closesAt: 4_000_000_000,
};
const setting = (manifest: VoteManifest) => ({ round: { manifest, by: ADMIN, at: 1 } });

Deno.test("ballotSlugs: the production round's slugs", async () => {
  const h = await harness();
  try {
    await h.db.meta.set(voteSettingKey("production"), setting(production));
    await h.db.meta.set(voteSettingKey("test"), setting(test));
    assertEquals(await ballotSlugs(h.db), new Set(["a", "b"]));
  } finally {
    h.close();
  }
});

Deno.test("ballotSlugs: none without a production round", async () => {
  const h = await harness();
  try {
    await h.db.meta.set(voteSettingKey("test"), setting(test));
    assertEquals(await ballotSlugs(h.db), new Set());
  } finally {
    h.close();
  }
});

Deno.test("assertOffBallot: refuses a change on the ballot", () => {
  const e = assertThrows(() => assertOffBallot(new Set(["a"]), "a", true), HttpError);
  assertEquals(e.status, 409);
  assertEquals(e.message, ON_BALLOT);
});

Deno.test("assertOffBallot: allows no change, or off the ballot", () => {
  assertOffBallot(new Set(["a"]), "a", false);
  assertOffBallot(new Set(["a"]), "z", true);
});

const GOOD = minimalSubmission(25000);

/** An approved initiative, with helpers to put it on the production ballot. */
async function approved(h: Harness) {
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const res = await h.req("/api/initiatives", { method: "POST", token, json: GOOD });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const id = (await h.db.initiatives.bySlug(slug))!.id;
  await deploySafe(h, admin, id);
  await h.req(`/api/admin/initiatives/${id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  const putOnBallot = () =>
    h.db.meta.set(voteSettingKey("production"), setting({ ...production, slugs: [slug] }));
  const patch = (json: unknown) =>
    h.req(`/api/initiatives/${slug}`, { method: "PATCH", token: admin, json });
  const edit = (json: unknown) =>
    h.req(`/api/initiatives/${slug}/revisions`, { method: "POST", token, json });
  const accept = (n: number) =>
    h.req(`/api/admin/initiatives/${id}/revisions/${n}/accept`, {
      method: "POST",
      token: admin,
      json: {},
    });
  const row = async () => (await h.db.initiatives.get(id))!;
  return { token, admin, slug, id, putOnBallot, patch, edit, accept, row };
}

/** An approved initiative put on the production ballot. */
async function onBallot(h: Harness) {
  const x = await approved(h);
  await x.putOnBallot();
  return x;
}

Deno.test("admin PATCH goal on the ballot: 202, the page keeps its goal until the round has it", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug, patch, row } = await onBallot(h);
    const res = await patch({ goal: 78000, durationMonths: 12 });
    assertEquals(res.status, 202);
    assertEquals(((await j(res)).goalRequest as { goalUsd: number }).goalUsd, 78000);
    assertEquals([(await row()).goalUsd, (await row()).durationMonths], [25000, 12]);
    const page = await j(await h.req(`/api/initiatives/${slug}`));
    assertEquals((page.goalRequest as { goalUsd: number }).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("admin PATCH back to the current goal drops the request", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug, patch } = await onBallot(h);
    assertEquals((await patch({ goal: 78000 })).status, 202);
    assertEquals((await patch({ goal: 25000 })).status, 200);
    assertEquals((await j(await h.req(`/api/initiatives/${slug}`))).goalRequest, undefined);
  } finally {
    h.close();
  }
});

Deno.test("off the ballot a goal edit applies as before", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { patch, row } = await approved(h);
    assertEquals((await patch({ goal: 78000 })).status, 200);
    assertEquals((await row()).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("PATCH type on the ballot: 409", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { patch, row } = await onBallot(h);
    assertEquals((await patch({ type: "grant" })).status, 409);
    assertEquals((await row()).type, "rfp");
  } finally {
    h.close();
  }
});

Deno.test("PATCH the same goal and other facts on the ballot: 200", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { patch, row } = await onBallot(h);
    const res = await patch({ goal: 25000, type: "rfp", durationMonths: 12 });
    assertEquals(res.status, 200);
    assertEquals((await row()).durationMonths, 12);
  } finally {
    h.close();
  }
});

Deno.test("an admin's live text edit with a new goal: the text goes live, the goal is requested", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug, admin, row } = await onBallot(h);
    const res = await h.req(`/api/initiatives/${slug}/revisions`, {
      method: "POST",
      token: admin,
      json: {
        ...revisionBody(minimalSubmission(78000)),
        title: "A retitled initiative",
        goal: 78000,
      },
    });
    assertEquals(res.status, 201);
    assertEquals([(await row()).title, (await row()).goalUsd], ["A retitled initiative", 25000]);
    const page = await j(await h.req(`/api/initiatives/${slug}`));
    assertEquals((page.goalRequest as { goalUsd: number }).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("GET says whether the initiative is on the ballot", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug } = await onBallot(h);
    assertEquals((await j(await h.req(`/api/initiatives/${slug}`))).onBallot, true);
    await h.db.meta.set(voteSettingKey("production"), setting(production));
    assertEquals((await j(await h.req(`/api/initiatives/${slug}`))).onBallot, false);
  } finally {
    h.close();
  }
});

Deno.test("accepting a proposer's held goal change on the ballot: the text goes live, the goal is requested", async () => {
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
    const after = await x.row();
    assertEquals([after.title, after.goalUsd, after.pendingRevision ?? null], [
      "A retitled initiative",
      25000,
      null,
    ]);
    const page = await j(await h.req(`/api/initiatives/${x.slug}`));
    assertEquals((page.goalRequest as { goalUsd: number }).goalUsd, 78000);
  } finally {
    h.close();
  }
});

Deno.test("accepting a held edit without a goal change on the ballot: 200", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await approved(h);
    await x.putOnBallot();
    const held = await j(
      await x.edit({ ...revisionBody(GOOD), title: "A retitled initiative", goal: 25000 }),
    );
    const res = await x.accept((held.revision as { n: number }).n);
    assertEquals(res.status, 200);
    assertEquals((await x.row()).title, "A retitled initiative");
  } finally {
    h.close();
  }
});

Deno.test("accepting a held goal change the page already has asks for nothing", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await approved(h);
    const held = await j(await x.edit({ ...revisionBody(minimalSubmission(78000)), goal: 78000 }));
    await x.putOnBallot();
    await h.db.initiatives.update(x.id, { goalUsd: 78000 }); // the site followed the round
    assertEquals((await x.accept((held.revision as { n: number }).n)).status, 200);
    assertEquals((await j(await h.req(`/api/initiatives/${x.slug}`))).goalRequest, undefined);
  } finally {
    h.close();
  }
});

Deno.test("affiliations of a ballot initiative: a change is 409, the same list is 200", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const x = await approved(h);
    const id = (await h.db.initiatives.insert({
      title: "A grant on the ballot",
      goalUsd: 50_000,
      status: "approved",
      type: "grant",
    })).id;
    await h.db.initiatives.update(id, { affiliations: ["SEAL", "Wallets"] });
    const slug = (await h.db.initiatives.get(id))!.slug;
    await h.db.meta.set(voteSettingKey("production"), setting({ ...production, slugs: [slug] }));
    const set = (affiliations: string) =>
      h.req(`/api/admin/initiatives/${id}`, {
        method: "PATCH",
        token: x.admin,
        json: { affiliations },
      });
    const res = await set("SEAL");
    assertEquals(res.status, 409);
    assertEquals((await j(res)).error, ON_BALLOT);
    assertEquals((await set("wallets, seal")).status, 200);
    assertEquals((await h.db.initiatives.get(id))!.affiliations, ["SEAL", "Wallets"]);
  } finally {
    h.close();
  }
});

Deno.test("sync-content keeps a ballot initiative's round facts and applies the rest", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const admin = await h.mint(ADMIN, true);
    const sync = (files: { name: string; text: string }[]) =>
      h.req("/api/admin/sync-content", { method: "POST", token: admin, json: { files } });
    const grant = syntheticContentFiles()[1];
    assertEquals((await sync([grant])).status, 200);
    const slug = "synthetic-grant";
    const before = (await h.db.initiatives.bySlug(slug))!;
    await h.db.meta.set(voteSettingKey("production"), setting({ ...production, slugs: [slug] }));
    const text = grant.text
      .replace("goal: 300000", "goal: 250000\naffiliations: SEAL")
      .replace("recipient_url: https://y.example/", "recipient_url: https://z.example/")
      .replace("Synthetic grant one", "Synthetic grant renamed")
      .replace(grantBody(300_000), grantBody(250_000));
    const res = await sync([{ name: grant.name, text }]);
    assertEquals(res.status, 200);
    const out = await j(res);
    assertEquals([out.errors, out.kept], [[], [slug]]);
    const after = (await h.db.initiatives.bySlug(slug))!;
    assertEquals([after.goalUsd, after.type, after.affiliations ?? []], [
      before.goalUsd,
      before.type,
      before.affiliations ?? [],
    ]);
    assertEquals([after.recipientUrl, after.title], [
      "https://z.example/",
      "Synthetic grant renamed",
    ]);
  } finally {
    h.close();
  }
});

Deno.test("after the vote closes a goal change on the ballot is refused: the round's facts are final", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug, patch, row } = await approved(h);
    await h.db.meta.set(
      voteSettingKey("production"),
      setting({ ...production, slugs: [slug], closesAt: 1 }),
    );
    const res = await patch({ goal: 78000 });
    assertEquals(res.status, 409);
    assertEquals((await j(res)).error, "The vote has closed: the round's goal is final.");
    assertEquals((await row()).goalUsd, 25000);
    assertEquals((await j(await h.req(`/api/initiatives/${slug}`))).goalRequest, undefined);
  } finally {
    h.close();
  }
});

Deno.test("off the ballot an admin can still fix an affiliation's case", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const admin = await h.mint(ADMIN, true);
    const id = (await h.db.initiatives.insert({
      title: "A grant off the ballot",
      goalUsd: 50_000,
      status: "approved",
      type: "grant",
    })).id;
    await h.db.initiatives.update(id, { affiliations: ["seal"] });
    const res = await h.req(`/api/admin/initiatives/${id}`, {
      method: "PATCH",
      token: admin,
      json: { affiliations: "SEAL" },
    });
    assertEquals(res.status, 200);
    assertEquals((await h.db.initiatives.get(id))!.affiliations, ["SEAL"]);
  } finally {
    h.close();
  }
});
