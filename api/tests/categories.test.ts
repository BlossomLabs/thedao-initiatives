/** Initiative categories: validation, every writer, the approval gate, the public shapes, AI pre-fill. */
import { assert, assertEquals } from "@std/assert";
import { ADMIN, deploySafe, harness, type Harness, j, proposerToken } from "./app-helpers.ts";
import { minimalSubmission } from "./fixtures.ts";
import { CATEGORIES, readCategories } from "../../shared/categories.ts";
import { aiFilterCategories } from "../services/ai.ts";

type Row = { initiative: { categories: string[]; status: string } };

const submit = (h: Harness, token: string, json: unknown) =>
  h.req("/api/initiatives", { method: "POST", token, json });

Deno.test("readCategories: 1 to 3 unique registry slugs, first is primary", () => {
  assertEquals(readCategories(["opsec"]), [["opsec"], null]);
  assertEquals(readCategories(["defi", "opsec", "compilers"])[0], ["defi", "opsec", "compilers"]);
  for (const bad of [[], ["opsec", "defi", "compilers", "infrastructure"], ["nope"], ["opsec", "opsec"], "opsec", null]) {
    const [list, err] = readCategories(bad);
    assertEquals(list, null);
    assert(err);
  }
  assertEquals(CATEGORIES.length, 10);
  assertEquals(new Set(CATEGORIES.map((c) => c.slug)).size, 10);
});

Deno.test("aiFilterCategories: registry slugs only, no repeats, at most 3", () => {
  assertEquals(aiFilterCategories(["bogus", "opsec", "opsec", "defi", "compilers", "infrastructure"]), [
    "opsec",
    "defi",
    "compilers",
  ]);
  assertEquals(aiFilterCategories("opsec"), []);
});

Deno.test("submit: categories are required and validated, then stored and shown", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const token = await proposerToken(h);
  for (const categories of [[], ["nope"], ["opsec", "defi", "compilers", "infrastructure"], undefined]) {
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

Deno.test("admin: categories editable in every status without a revision; approve needs one", async () => {
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
  const patch = (json: unknown) =>
    h.req(`/api/admin/initiatives/${row.id}`, { method: "PATCH", token: admin, json });
  for (const categories of [[], ["nope"], ["opsec", "opsec"], "opsec"]) {
    assertEquals((await patch({ categories })).status, 400);
  }
  const ok = await j(await patch({ categories: ["wallets-signing", "opsec"] })) as Row;
  assertEquals(ok.initiative.categories, ["wallets-signing", "opsec"]);
  assertEquals((await approve()).status, 200);
  // archived rows stay taggable, and no edit makes a text revision
  await h.db.initiatives.update(row.id, { status: "archived" });
  assertEquals((await j(await patch({ categories: ["defi"] })) as Row).initiative.categories, ["defi"]);
  assertEquals((await h.db.initiatives.get(row.id))!.revision, 1);
  h.close();
});

Deno.test("proposer: categories editable while the text is (pending and approved), other facts lock", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const token = await proposerToken(h);
  const { slug } = await j(await submit(h, token, minimalSubmission(1000))) as { slug: string };
  const patch = (json: unknown) =>
    h.req(`/api/initiatives/${slug}`, { method: "PATCH", token, json });
  assertEquals((await patch({ categories: ["nope"] })).status, 400);
  assertEquals((await j(await patch({ categories: ["compilers"] })) as Row).initiative.categories, [
    "compilers",
  ]);
  const row = (await h.db.initiatives.bySlug(slug))!;
  await h.db.initiatives.update(row.id, { status: "approved" });
  assertEquals((await patch({ categories: ["compilers", "formal-verification"] })).status, 200);
  assertEquals((await patch({ categories: ["opsec"], goal: "5,000" })).status, 403);
  await h.db.initiatives.update(row.id, { status: "rejected" });
  assertEquals((await patch({ categories: ["opsec"] })).status, 403);
  h.close();
});

Deno.test("board and page: categories on cards and the public initiative; legacy rows show none", async () => {
  const h = await harness();
  await h.db.initiatives.insert({
    title: "Tagged approved row",
    status: "approved",
    categories: ["defi", "audits-analysis"],
  });
  const legacy = await h.db.initiatives.insert({ title: "Legacy approved row", status: "approved" });
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
  const body = { title: "Formal verification of the compiler", summary: "Prove the Vyper compiler correct end to end." };
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
