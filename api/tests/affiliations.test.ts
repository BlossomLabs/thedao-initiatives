/** Affiliations: admin-only, never on an RFP, never in a public page or feed; the deploy
 * reads them from /api/initiatives/affiliations. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { ADMIN, harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { grantBody, minimalSubmission, revisionBody } from "./fixtures.ts";
import { parseInitiativeFile } from "../services/content.ts";

async function setup() {
  const h = await harness();
  const grant = await h.db.initiatives.insert({
    ...revisionBody(minimalSubmission(100_000, "grant")),
    title: "Seal audits",
    type: "grant",
    goalUsd: 100_000,
    status: "approved",
    safeAddress: SAFE_ADDR,
  });
  const rfp = await h.db.initiatives.insert({
    ...revisionBody(minimalSubmission(50_000)),
    title: "Open wallet tests",
    goalUsd: 50_000,
    status: "approved",
  });
  const token = await h.mint(ADMIN, true);
  return { h, grant, rfp, token };
}

Deno.test("admin sets affiliations; an RFP's affiliations are refused", async () => {
  const { h, grant, rfp, token } = await setup();
  const ok = await h.req(`/api/admin/initiatives/${grant.id}`, {
    method: "PATCH",
    token,
    json: { affiliations: "Seal, wallets, seal" },
  });
  assertEquals(ok.status, 200);
  assertEquals(((await j(ok)).initiative as { affiliations: string[] }).affiliations, [
    "Seal",
    "wallets",
  ]);
  assertEquals((await h.db.initiatives.get(grant.id))!.affiliations, ["Seal", "wallets"]);
  const no = await h.req(`/api/admin/initiatives/${rfp.id}`, {
    method: "PATCH",
    token,
    json: { affiliations: "Seal" },
  });
  assertEquals(no.status, 400);
  assertEquals((await j(no)).error, "RFPs can't have affiliations.");
  h.close();
});

Deno.test("affiliations appear in no public page or feed; /api/initiatives/affiliations lists them", async () => {
  const { h, grant, token } = await setup();
  await h.req(`/api/admin/initiatives/${grant.id}`, {
    method: "PATCH",
    token,
    json: { affiliations: "Zebratag" },
  });
  for (
    const path of [
      "/llms.txt",
      "/llms-full.txt",
      "/api/initiatives.json",
      "/api/board",
      `/api/initiatives/${grant.slug}`,
      `/initiative/${grant.slug}.md`,
    ]
  ) {
    const res = await h.req(path);
    assert(!(await res.text()).includes("Zebratag"), `${path} shows a affiliation`);
  }
  const res = await h.req("/api/initiatives/affiliations");
  assertEquals(await res.json(), { affiliations: { [grant.slug]: ["Zebratag"] } });
  h.close();
});

Deno.test("content: affiliations parse; an RFP with affiliations is an error", () => {
  const head = (type: string, affiliations: string) =>
    `---\ntitle: Tagged\nsummary: A tagged initiative for the vote.\ngoal: 1000\ntype: ${type}\n` +
    `affiliations: ${affiliations}\n---\n`;
  const grant = parseInitiativeFile(head("grant", "Seal, Wallets") + grantBody(1000));
  assertEquals(grant.affiliations, ["Seal", "Wallets"]);
  assertThrows(
    () => parseInitiativeFile(head("rfp", "Seal") + "Body."),
    Error,
    "RFPs can't have affiliations",
  );
});
