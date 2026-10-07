/** Initiative categories: validation, every writer, the approval gate, the public shapes, AI pre-fill. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ADMIN, deploySafe, type Harness, harness, j, proposerToken } from "./app-helpers.ts";
import { minimalSubmission, revisionBody } from "./fixtures.ts";
import { CATEGORIES, readCategories } from "../../shared/categories.ts";
import { aiFilterCategories } from "../services/ai.ts";
import { K } from "../db/keys.ts";

type Row = { initiative: { categories: string[]; status: string } };

const submit = (h: Harness, token: string, json: unknown) =>
  h.req("/api/initiatives", { method: "POST", token, json });

Deno.test("readCategories: 1 to 3 unique registry slugs, first is primary", () => {
  assertEquals(readCategories(["opsec"]), [["opsec"], null]);
  assertEquals(readCategories(["defi", "opsec", "compilers"])[0], ["defi", "opsec", "compilers"]);
  for (
    const bad of [
      [],
      ["opsec", "defi", "compilers", "infrastructure"],
      ["nope"],
      ["opsec", "opsec"],
      "opsec",
      null,
    ]
  ) {
    const [list, err] = readCategories(bad);
    assertEquals(list, null);
    assert(err);
  }
  assertEquals(CATEGORIES.length, 10);
  assertEquals(new Set(CATEGORIES.map((c) => c.slug)).size, 10);
});

Deno.test("aiFilterCategories: registry slugs only, no repeats, at most 3", () => {
  assertEquals(
    aiFilterCategories(["bogus", "opsec", "opsec", "defi", "compilers", "infrastructure"]),
    [
      "opsec",
      "defi",
      "compilers",
    ],
  );
  assertEquals(aiFilterCategories("opsec"), []);
});

Deno.test("submit: categories are required and validated, then stored and shown", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const token = await proposerToken(h);
  for (
    const categories of [[], ["nope"], ["opsec", "defi", "compilers", "infrastructure"], undefined]
  ) {
    const res = await submit(h, token, { ...minimalSubmission(1000), categories });
    assertEquals(res.status, 400);
    const body = await j(res) as { findings: { errors: { field: string }[] } };
    assert(body.findings.errors.some((e) => e.field === "categories"));
  }
  const res = await submit(h, token, { ...minimalSubmission(1000), categories: ["defi", "opsec"] });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  assertEquals((await h.db.initiatives.bySlug(slug))!.categories, ["defi", "opsec"]);
  h.close();
});

const revise = (h: Harness, slug: string, token: string, json: unknown) =>
  h.req(`/api/initiatives/${slug}/revisions`, { method: "POST", token, json });

Deno.test("db: categories are written with a revision and snapshotted in it, never patched", async () => {
  const h = await harness();
  const origin = { author: "0xabc", source: "proposer" as const };
  const text = { title: "Tagged from birth", summary: "s", details: "d" };
  const row = await h.db.initiatives.insert({ ...text, categories: ["opsec"] });
  assertEquals((await h.db.revisions.get(row.id, 1))!.categories, ["opsec"]);
  // same text, same categories: nothing to write
  assertEquals(
    (await h.db.initiatives.revise(row.id, { ...text, categories: ["opsec"] }, origin)).revision,
    null,
  );
  // a text edit that names no categories keeps and snapshots the row's
  const worded = await h.db.initiatives.revise(row.id, { ...text, details: "d2" }, origin);
  assertEquals(worded.revision!.categories, ["opsec"]);
  assertEquals(worded.initiative.categories, ["opsec"]);
  // text and categories change in one revision; the order (primary first) counts
  const both = await h.db.initiatives.revise(
    row.id,
    { ...text, details: "d3", categories: ["defi", "opsec"] },
    origin,
  );
  assertEquals(both.revision!.n, 3);
  assertEquals(both.revision!.categories, ["defi", "opsec"]);
  assertEquals((await h.db.initiatives.get(row.id))!.categories, ["defi", "opsec"]);
  // categories alone are a revision too, with the text as it stands
  const tagged = await h.db.initiatives.retag(row.id, ["opsec", "defi"], origin);
  assertEquals(tagged.revision!.n, 4);
  assertEquals(tagged.revision!.details, "d3");
  assertEquals(tagged.initiative.categories, ["opsec", "defi"]);
  assertEquals((await h.db.initiatives.retag(row.id, ["opsec", "defi"], origin)).revision, null);
  await assertRejects(
    () => h.db.initiatives.update(row.id, { categories: ["defi"] }),
    Error,
    "field not allowed: categories",
  );
  h.close();
});

Deno.test("admin: categories change through a revision in every status; approve needs one", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const row = await h.db.initiatives.insert({ title: "Untagged initiative", status: "pending" });
  await deploySafe(h, admin, row.id);
  const approve = () =>
    h.req(`/api/admin/initiatives/${row.id}/status`, {
      method: "POST",
      token: admin,
      json: { action: "approve" },
    });
  const refused = await approve();
  assertEquals(refused.status, 400);
  assertEquals((await j(refused)).error, "Add at least one category to approve.");
  // the admin settings no longer take categories
  const patched = await h.req(`/api/admin/initiatives/${row.id}`, {
    method: "PATCH",
    token: admin,
    json: { categories: ["opsec"] },
  });
  assertEquals(patched.status, 400);
  assertEquals((await h.db.initiatives.get(row.id))!.categories, []);
  const tag = (categories: unknown) => revise(h, row.slug, admin, { categories });
  for (const categories of [[], ["nope"], ["opsec", "opsec"], "opsec"]) {
    const bad = await tag(categories);
    assertEquals(bad.status, 400);
    const body = await j(bad) as { findings: { errors: { field: string }[] } };
    assert(body.findings.errors.some((e) => e.field === "categories"));
  }
  // categories alone: a legacy text needs no rewrite to be tagged
  const ok = await tag(["wallets-signing", "opsec"]);
  assertEquals(ok.status, 201);
  const out = await j(ok) as Row & { revision: { n: number; source: string } };
  assertEquals(out.initiative.categories, ["wallets-signing", "opsec"]);
  assertEquals([out.revision.n, out.revision.source], [2, "admin"]);
  assertEquals((await tag(["wallets-signing", "opsec"])).status, 400); // nothing changed
  assertEquals((await approve()).status, 200);
  // archived rows stay taggable by the team (unarchiving needs a category); their text stays shut
  await h.db.initiatives.update(row.id, { status: "archived" });
  assertEquals((await j(await tag(["defi"])) as Row).initiative.categories, ["defi"]);
  assertEquals((await h.db.initiatives.get(row.id))!.revision, 3);
  assertEquals((await h.db.revisions.get(row.id, 3))!.title, "Untagged initiative");
  h.close();
});

Deno.test("proposer: categories change only with a revision, while the text is editable", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const token = await proposerToken(h);
  const draft = minimalSubmission(1000);
  const { slug } = await j(await submit(h, token, draft)) as { slug: string };
  const id = (await h.db.initiatives.bySlug(slug))!.id;
  // the page facts no longer take categories, in any status
  const patch = (json: unknown) =>
    h.req(`/api/initiatives/${slug}`, { method: "PATCH", token, json });
  assertEquals((await patch({ categories: ["compilers"] })).status, 400);
  assertEquals((await h.db.initiatives.get(id))!.categories, ["audits-analysis"]);

  const bad = await revise(h, slug, token, { categories: ["nope"] });
  assertEquals(bad.status, 400);
  // categories alone
  const alone = await revise(h, slug, token, { categories: ["compilers"] });
  assertEquals(alone.status, 201);
  assertEquals((await j(alone) as Row).initiative.categories, ["compilers"]);
  // text and categories in one revision
  const both = await revise(h, slug, token, {
    ...revisionBody(draft),
    title: "A retitled initiative here",
    categories: ["compilers", "formal-verification"],
  });
  assertEquals(both.status, 201);
  const row = (await h.db.initiatives.get(id))!;
  assertEquals([row.title, row.categories, row.revision], [
    "A retitled initiative here",
    ["compilers", "formal-verification"],
    3,
  ]);
  // a bad list refuses the whole edit, text included
  const refused = await revise(h, slug, token, {
    ...revisionBody(draft),
    title: "Another title for this one",
    categories: [],
  });
  assertEquals(refused.status, 400);
  assertEquals((await h.db.initiatives.get(id))!.title, "A retitled initiative here");
  // the history shows each version's categories; one written before they were recorded has none
  const shown = async (n: number) =>
    (await j(await h.req(`/api/initiatives/${slug}/revisions/${n}`, { token })) as {
      revision: { categories: string[] | null };
    }).revision.categories;
  assertEquals(await shown(1), ["audits-analysis"]);
  assertEquals(await shown(3), ["compilers", "formal-verification"]);
  const { categories: _, ...old } = (await h.db.revisions.get(id, 2))!;
  await h.kv.set(K.revision(id, 2), old);
  assertEquals(await shown(2), null);
  // closed with the text: a rejected row takes no categories from its proposer
  await h.db.initiatives.update(id, { status: "rejected" });
  assertEquals((await revise(h, slug, token, { categories: ["opsec"] })).status, 403);
  h.close();
});

Deno.test("board and page: categories on cards and the public initiative; legacy rows show none", async () => {
  const h = await harness();
  await h.db.initiatives.insert({
    title: "Tagged approved row",
    status: "approved",
    categories: ["defi", "audits-analysis"],
  });
  const legacy = await h.db.initiatives.insert({
    title: "Legacy approved row",
    status: "approved",
  });
  // a row written before categories existed has no key at all
  const { categories: _, ...bare } = (await h.db.initiatives.get(legacy.id))!;
  await h.kv.set(["rfp", legacy.id], bare);
  const board = await j(await h.req("/api/board")) as {
    cards: { initiative: { title: string; categories: string[] } }[];
  };
  const byTitle = Object.fromEntries(board.cards.map((c) => [c.initiative.title, c.initiative]));
  assertEquals(byTitle["Tagged approved row"].categories, ["defi", "audits-analysis"]);
  assertEquals(byTitle["Legacy approved row"].categories, []);
  const page = await j(await h.req(`/api/initiatives/${legacy.slug}`)) as Row;
  assertEquals(page.initiative.categories, []);
  h.close();
});

Deno.test("ai-categories: mocked provider, bogus slugs dropped, needs text, disabled", async () => {
  const off = await harness();
  const body = {
    title: "Formal verification of the compiler",
    summary: "Prove the Vyper compiler correct end to end.",
  };
  assertEquals((await off.req("/api/ai-categories", { method: "POST", json: body })).status, 503);
  off.close();
  const h = await harness({
    env: { AI_SEARCH_API_KEY: "k" },
    fetch: (url) => {
      if (!url.includes("/chat/completions")) return new Response("", { status: 404 });
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({ categories: ["bogus", "formal-verification", "compilers"] }),
          },
        }],
      });
    },
  });
  assertEquals(
    (await h.req("/api/ai-categories", { method: "POST", json: { title: "x", summary: "y" } }))
      .status,
    400,
  );
  const res = await j(await h.req("/api/ai-categories", { method: "POST", json: body }));
  assertEquals(res.categories, ["formal-verification", "compilers"]);
  h.close();
});
