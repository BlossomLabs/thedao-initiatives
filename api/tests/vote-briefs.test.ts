/** The vote briefs (#96): "Paid on adoption" from the milestones, the rest written by the
 * model only when an admin reviews the text (an approval, an accepted edit, an admin's
 * live edit, Rewrite summary). Never from a view, a pending edit, a bulk approve (the page
 * asks per initiative) or the content sync. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ADMIN,
  deploySafe,
  harness,
  j,
  loadContentFiles,
  PLAIN,
  proposerToken,
  seedContentLogos,
} from "./app-helpers.ts";
import { minimalSubmission, revisionBody } from "./fixtures.ts";
import type { VoteBrief } from "../../shared/vote/brief.ts";

const MILESTONES = [
  {
    name: "Spec",
    amount: 50_000,
    adoption: false,
    done: false,
    link: "",
    month: "",
    criteria: ["A spec"],
  },
  {
    name: "Adoption by clients",
    amount: 150_000,
    adoption: true,
    done: false,
    link: "",
    month: "",
    criteria: ["Two execution clients run it"],
  },
];

type BriefState = { brief: VoteBrief | null; current: boolean; at: number | null };

/** A harness whose model answers with bullets numbered by call (`state.fail`: nothing
 * usable). */
async function setup(opts: { delayMs?: number; refuseJsonMode?: boolean } = {}) {
  const inputs: string[] = [];
  const state = { fail: false };
  const h = await harness({
    env: { AI_SEARCH_API_KEY: "k" },
    fetch: async (url, init) => {
      if (!url.includes("/chat/completions")) return new Response("", { status: 404 });
      const body = JSON.parse(String(init?.body ?? "{}"));
      // A short wait, so parallel calls are in flight together.
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.refuseJsonMode && body.response_format) {
        return new Response("structured output (response_format) is not supported", {
          status: 400,
        });
      }
      inputs.push(String(body.messages?.[1]?.content ?? ""));
      const content = state.fail ? "{}" : JSON.stringify({
        what: [{ title: "Verified EVM", text: `Builds draft ${inputs.length}.` }],
        adoption: ["Two execution clients must run it"],
      });
      return Response.json({ choices: [{ message: { content } }] });
    },
  });
  const admin = await h.mint(ADMIN, true);
  const view = async () => {
    h.clock.now += 31; // past the briefs' cache
    const out = await j(await h.req("/api/board/vote-briefs")) as {
      briefs: Record<string, VoteBrief>;
    };
    await h.settle();
    return out.briefs;
  };
  const brief = async (id: string) =>
    await j(await h.req(`/api/admin/initiatives/${id}/vote-brief`, { token: admin })) as
      & BriefState
      & Record<string, unknown>;
  const rewrite = (id: string, json: Record<string, unknown> = {}, token = admin) =>
    h.req(`/api/admin/initiatives/${id}/vote-brief`, { method: "POST", token, json });
  return { h, admin, inputs, state, view, brief, rewrite };
}

/** A proposer's initiative, submitted through the form, its Safe deployed. */
async function submitted(h: Awaited<ReturnType<typeof setup>>["h"], admin: string) {
  const GOOD = minimalSubmission(25000);
  const token = await proposerToken(h);
  const { slug } = await j(
    await h.req("/api/initiatives", { method: "POST", token, json: GOOD }),
  ) as { slug: string };
  const id = (await h.db.initiatives.bySlug(slug))!.id;
  await deploySafe(h, admin, id);
  return { GOOD, token, slug, id };
}

Deno.test("vote briefs: a view never asks the model; Rewrite summary does, at once", async () => {
  const { h, inputs, state, view, brief, rewrite } = await setup();
  const r = await h.db.initiatives.insert({
    title: "Verified EVM",
    status: "approved",
    goalUsd: 200_000,
    proposer: PLAIN,
    milestones: MILESTONES,
  });
  // Views: the numbers only, and no model call however many there are.
  assertEquals((await view())[r.slug], {
    what: null,
    adoption: null,
    goalUsd: 200_000,
    adoptionUsd: 150_000,
  });
  await view();
  assertEquals(inputs.length, 0);
  assertEquals(await brief(r.id), { brief: null, current: false, at: null });

  // Rewrite summary: written while the request waits.
  const res = await rewrite(r.id);
  assertEquals(res.status, 200);
  const out = await j(res) as BriefState;
  assertEquals(out.current, true);
  assertEquals(out.brief?.what, [{ title: "Verified EVM", text: "Builds draft 1." }]);
  assertEquals((await view())[r.slug].adoption, ["Two execution clients must run it"]);

  // `missing`: nothing is written when they already stand for the text.
  assertEquals((await rewrite(r.id, { missing: true })).status, 200);
  assertEquals(inputs.length, 1);

  // The text changes outside a review (as the content sync would): the card loses them,
  // the admin page shows them out of date, and nothing is written by itself.
  await h.kv.set(["rfp", r.id], { ...(await h.db.initiatives.get(r.id))!, summary: "New." });
  assertEquals((await view())[r.slug].what, null);
  const stale = await brief(r.id);
  assertEquals([stale.current, stale.brief?.what?.[0].text], [false, "Builds draft 1."]);
  assertEquals(inputs.length, 1);

  // A model failure says why; nobody else may ask.
  state.fail = true;
  const failed = await rewrite(r.id);
  assertEquals(failed.status, 503);
  assertStringIncludes(String((await j(failed)).error), "bad reply");
  assertEquals((await rewrite(r.id, {}, await h.mint(PLAIN))).status, 403);
  h.close();
});

Deno.test("vote briefs: an approval, an accepted edit and an admin's live edit write them", async () => {
  const { h, admin, inputs, brief } = await setup();
  const { GOOD, token, slug, id } = await submitted(h, admin);
  await h.req(`/api/admin/initiatives/${id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  await h.settle();
  assertEquals(inputs.length, 1, "the approval wrote its bullets");
  assertEquals((await brief(id)).current, true);

  // The proposer's edit waits for an admin: the live text, and the bullets, stay.
  h.clock.now += 100;
  const edit = { ...revisionBody(GOOD), sections: { ...GOOD.sections, why: "Second draft." } };
  const sent = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token,
    json: edit,
  });
  assertEquals(sent.status, 201);
  await h.settle();
  assertEquals(inputs.length, 1);

  // Accepted: the text changed, and the model writes the bullets again.
  const ok = await h.req(`/api/admin/initiatives/${id}/revisions/2/accept`, {
    method: "POST",
    token: admin,
  });
  assertEquals(ok.status, 200);
  await h.settle();
  assertEquals(inputs.length, 2);
  assert(inputs[1].includes("Second draft."));
  assertEquals((await brief(id)).current, true);

  // An admin's live edit of someone else's initiative is reviewed text too.
  h.clock.now += 100;
  const live = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token: admin,
    json: { ...edit, title: "Renamed by the team" },
  });
  assertEquals(live.status, 201);
  await h.settle();
  assertEquals(inputs.length, 3);
  assert(inputs[2].includes("Renamed by the team"));
  h.close();
});

Deno.test("vote briefs: a bulk approve and the content sync write nothing by themselves", async () => {
  const { h, admin, inputs } = await setup();
  const { id } = await submitted(h, admin);
  const bulk = await h.req("/api/admin/initiatives/bulk", {
    method: "POST",
    token: admin,
    json: { ids: [id], action: "approve" },
  });
  assertEquals(bulk.status, 200);
  assertEquals((await h.db.initiatives.get(id))!.status, "approved");
  await seedContentLogos(h);
  const sync = await h.req("/api/admin/sync-content", {
    method: "POST",
    token: admin,
    json: { files: await loadContentFiles() },
  });
  assertEquals(sync.status, 200);
  await h.settle();
  assertEquals(inputs.length, 0, "the page asks per initiative after a bulk approve");
  h.close();
});

Deno.test("vote briefs: calls refused JSON mode together each retry without it", async () => {
  // Nexus refuses response_format; the bulk approve's page sends three at a time, so
  // several are refused before the first refusal switches the client over.
  const { h, rewrite, inputs } = await setup({ delayMs: 5, refuseJsonMode: true });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(
      (await h.db.initiatives.insert({ title: `Initiative ${i}`, status: "approved", goalUsd: 1 }))
        .id,
    );
  }
  const statuses = await Promise.all(ids.map(async (id) => (await rewrite(id)).status));
  assertEquals(statuses, [200, 200, 200]);
  assertEquals(inputs.length, 3);
  h.close();
});
