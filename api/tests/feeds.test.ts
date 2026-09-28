/** Agent-readable feeds: approved only, the allowlist, headers, filters, and the no-JS pages. */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { createApp } from "../app.ts";
import { createStaticSite } from "../site.ts";
import { harness, PLAIN, SAFE_ADDR, testConnection } from "./app-helpers.ts";
import { minimalSubmission, revisionBody } from "./fixtures.ts";
import { FEED_JSON_SCHEMA } from "../services/feed-schema.ts";
import { parseInitiativeFile } from "../services/content.ts";

const HOST = "https://initiatives.thedao.fund";

async function setup() {
  const h = await harness({ env: { CSP_ENFORCE: "false", WEB_ORIGIN: HOST } });
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${root}/index.html`,
    `<html><head><title>Board</title></head><body><div id="root">HOME</div></body></html>`,
  );
  await Deno.writeTextFile(
    `${root}/__spa-fallback.html`,
    "<html><head></head><body>SPA FALLBACK</body></html>",
  );
  const site = await createStaticSite({ root, siteUrl: HOST }, false);
  const app = createApp(h.deps, undefined, site);
  const draft = revisionBody(minimalSubmission(100_000, "grant"));
  const live = await h.db.initiatives.insert({
    ...draft,
    title: "Formal proofs for the compiler",
    summary: "Machine-checked proofs that the compiler preserves meaning.",
    type: "grant",
    recipientTeam: "Proof Team",
    goalUsd: 100_000,
    status: "approved",
    safeAddress: SAFE_ADDR,
    contact: "secret-contact@example.com",
    funders: "Secret funder lead | why | none | no | $1",
    categories: ["formal-verification", "compilers"],
    proposer: PLAIN,
  });
  await h.db.pledges.add(live.id, {
    company: "Example Foundation",
    amountUsd: 25_000,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  await h.db.pledges.add(live.id, {
    company: "Withdrawn Co",
    amountUsd: 5_000,
    status: "withdrawn",
    note: "",
    url: "",
    logoCid: "",
  });
  const rfp = await h.db.initiatives.insert({
    ...revisionBody(minimalSubmission(50_000)),
    title: "Open wallet conformance tests",
    goalUsd: 50_000,
    status: "approved",
    categories: ["wallets-signing"],
  });
  const pending = await h.db.initiatives.insert({
    title: "Hidden pending initiative",
    status: "pending",
    categories: ["opsec"],
  });
  const req = (path: string, init?: RequestInit) =>
    app.request(HOST + path, init, testConnection());
  return {
    h,
    app,
    live,
    rfp,
    pending,
    req,
    async close() {
      h.close();
      await Deno.remove(root, { recursive: true });
    },
  };
}

Deno.test("feeds: approved only, allowlisted fields, open CORS, cache and ETag", async () => {
  const t = await setup();
  try {
    for (
      const [path, type] of [
        ["/llms.txt", "text/plain"],
        ["/llms-full.txt", "text/plain"],
        ["/sitemap.xml", "application/xml"],
        ["/api/initiatives.json", "application/json"],
        ["/api/initiatives.schema.json", "application/schema+json"],
      ]
    ) {
      const res = await t.req(path, { headers: { Origin: "https://agent.example" } });
      assertEquals(res.status, 200, path);
      assertStringIncludes(res.headers.get("Content-Type")!, type);
      assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*", path);
      assertFalse(res.headers.get("Access-Control-Allow-Credentials") === "true", path);
      assertEquals(res.headers.get("Cache-Control"), "public, max-age=300", path);
      const etag = res.headers.get("ETag")!;
      assert(etag, path);
      const body = await res.text();
      for (const secret of ["secret-contact", "Secret funder", "Hidden pending", "Withdrawn Co"]) {
        assertFalse(body.includes(secret), `${path} leaks ${secret}`);
      }
      assertEquals((await t.req(path, { headers: { "If-None-Match": etag } })).status, 304);
    }
    const index = await (await t.req("/llms.txt")).text();
    assert(index.startsWith("# TheDAO Security Fund Initiatives\n\n> 2 approved"));
    assertStringIncludes(
      index,
      `- [Formal proofs for the compiler](${HOST}/initiative/${t.live.slug}.md): Grant, Formal Verification`,
    );
    assertStringIncludes(index, `(${HOST}/submit.md)`);
    const full = await (await t.req("/llms-full.txt")).text();
    assertStringIncludes(full, "## Formal proofs for the compiler");
    assertStringIncludes(full, "- Categories: Formal Verification, Compilers & Languages");
    assertStringIncludes(full, `- Donate: Safe ${SAFE_ADDR} on Ethereum mainnet (chain 1)`);
    assertStringIncludes(full, "- Pledged by: Example Foundation ($25,000)");
    assertStringIncludes(full, "### Milestones");
    // a spoofed host never lands in a cached body
    const spoofed = await (await t.app.request("https://attacker.test/llms.txt")).text();
    assertFalse(spoofed.includes("attacker.test"));
    assertStringIncludes(spoofed, `${HOST}/llms-full.txt`);
    const map = await (await t.req("/sitemap.xml")).text();
    assertStringIncludes(map, `<loc>${HOST}/initiative/${t.live.slug}</loc>`);
    assertFalse(map.includes(t.pending.slug));
  } finally {
    await t.close();
  }
});

Deno.test("initiatives.json: shape, totals, filters by type, category and status", async () => {
  const t = await setup();
  try {
    type J = {
      schemaVersion: number;
      count: number;
      totals: { goalUsd: number; rfps: number; grants: number };
      initiatives: Record<string, unknown>[];
    };
    const all = await (await t.req("/api/initiatives.json")).json() as J;
    assertEquals(all.schemaVersion, 1);
    assertEquals(all.count, 2);
    assertEquals(all.totals, { ...all.totals, goalUsd: 150_000, rfps: 1, grants: 1 });
    const one = all.initiatives.find((x) => x.slug === t.live.slug)!;
    // exactly the schema's properties: nothing private rides along
    assertEquals(
      Object.keys(one).sort(),
      Object.keys(FEED_JSON_SCHEMA.$defs.initiative.properties).sort(),
    );
    assertEquals(one.categories, [
      { slug: "formal-verification", label: "Formal Verification" },
      { slug: "compilers", label: "Compilers & Languages" },
    ]);
    assertEquals((one.donate as { safeAddress: string }).safeAddress, SAFE_ADDR);
    const q = async (s: string) =>
      ((await (await t.req("/api/initiatives.json?" + s)).json()) as J).initiatives.map((x) =>
        x.slug
      );
    assertEquals(await q("type=rfp"), [t.rfp.slug]);
    assertEquals(await q("cat=wallets-signing,opsec"), [t.rfp.slug]);
    assertEquals(await q("status=funded"), []);
    assertEquals((await q("status=open")).length, 2);
  } finally {
    await t.close();
  }
});

Deno.test("markdown file: feed facts in front matter, still syncs back, approved rows only", async () => {
  const t = await setup();
  try {
    const res = await t.req(`/initiative/${t.live.slug}.md`);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
    const md = await res.text();
    assertStringIncludes(md, `url: ${HOST}/initiative/${t.live.slug}`);
    assertStringIncludes(md, "categories: formal-verification, compilers");
    assertStringIncludes(md, `safe: ${SAFE_ADDR}`);
    assertFalse(md.includes("secret-contact"));
    assertEquals(parseInitiativeFile(md).goalUsd, 100_000);
    assertEquals((await t.req(`/initiative/${t.pending.slug}.md`)).status, 404);
    assertEquals((await t.req(`/api/initiatives/${t.pending.slug}`)).status, 404);
  } finally {
    await t.close();
  }
});

Deno.test("pages: text, alternates and JSON-LD without JavaScript; pending pages get none", async () => {
  const t = await setup();
  try {
    const home = await (await t.req("/")).text();
    assertStringIncludes(home, '<div id="root">HOME</div>');
    assertStringIncludes(home, '"@type":"ItemList"');
    assertStringIncludes(home, `href="${HOST}/llms-full.txt"`);
    assertStringIncludes(home, "<noscript>");
    assertStringIncludes(home, "Formal proofs for the compiler");
    const page = await t.req(`/initiative/${t.live.slug}`);
    assertEquals(page.status, 200);
    const html = await page.text();
    assertStringIncludes(
      html,
      "<title>Formal proofs for the compiler · TheDAO Security Fund</title>",
    );
    assertStringIncludes(html, `<link rel="canonical" href="${HOST}/initiative/${t.live.slug}">`);
    assertStringIncludes(html, `type="text/markdown" href="${HOST}/initiative/${t.live.slug}.md"`);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]);
    assertEquals(ld["@type"], "Project");
    assertEquals(ld.potentialAction["@type"], "DonateAction");
    assertEquals(ld.potentialAction.recipient.identifier, SAFE_ADDR);
    assertEquals(ld.funder, [{ "@type": "Organization", name: "Example Foundation" }]);
    assertStringIncludes(html, "Raised: $25,000 (25% funded) from 1 backer");
    const hidden = await (await t.req(`/initiative/${t.pending.slug}`)).text();
    assertEquals(hidden, "<html><head></head><body>SPA FALLBACK</body></html>");
  } finally {
    await t.close();
  }
});
