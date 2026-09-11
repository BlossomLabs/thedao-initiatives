/** Structured initiatives: submit, logo uploads, proposer edits and page
 * facts, the admin editor's findings. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, type Harness, harness, j, PLAIN, proposerToken } from "./app-helpers.ts";
import { exampleSubmission, minimalSubmission } from "./fixtures.ts";
import { LIMITS, SECTIONS, TOO_LONG_MSG } from "../../shared/draft/mod.ts";
import type { Rfp } from "../db/types.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const OTHER = "0x2222222222222222222222222222222222222222";

type Finding = { field: string; msg: string; kind?: string };
type Findings = { errors: Finding[]; warnings: Finding[] };
type Fail = { error: string; findings: Findings };
type Out = { initiative: Record<string, unknown>; findings?: Findings; warnings?: Finding[] };

const fields = (f: Finding[]) => f.map((e) => e.field);

/** A harness whose Pinata answers with a fresh CID per upload. */
async function pinataHarness() {
  let n = 0;
  const h = await harness({
    env: { PINATA_JWT: "jwt" },
    fetch: (url) =>
      url.startsWith("https://uploads.pinata.cloud/")
        ? Response.json({ data: { cid: "bafylogo" + String(++n).padStart(40, "0") } })
        : new Response("", { status: 404 }),
  });
  return h;
}

const submit = (h: Harness, token: string, json: unknown) =>
  h.req("/api/initiatives", { method: "POST", token, json });

async function uploadLogo(h: Harness, token: string, bytes = PNG) {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), "logo.png");
  return await h.req("/api/uploads/logo", { method: "POST", token, body: form });
}

Deno.test("submit: the guide's example lands structured, with its backers as pledges", async () => {
  const h = await pinataHarness();
  const token = await proposerToken(h);
  const { cid } = await j(await uploadLogo(h, token)) as { cid: string };
  const payload = {
    ...(await exampleSubmission()),
    backers: [
      { org: "Acme Labs", amountUsd: "20,000", url: "https://acme.example/", logoCid: cid },
      { org: "", amountUsd: "", url: "", logoCid: "" },
    ],
  };
  const res = await submit(h, token, payload);
  assertEquals(res.status, 201);
  const out = await j(res) as { slug: string; status: string; warnings: Finding[] };
  assertEquals(out.status, "pending");
  assertEquals(out.warnings, []);
  const row = (await h.db.rfps.bySlug(out.slug))!;
  assertEquals(row.details, "");
  assertEquals(Object.keys(row.sections), SECTIONS.rfp);
  assertEquals(row.goalUsd, 150000);
  assertEquals(row.durationMonths, 18);
  assertEquals(row.links.length, 2);
  assertEquals(row.milestones.map((m) => [m.amount, m.adoption]), [
    [50000, false],
    [25000, false],
    [75000, true],
  ]);
  assertEquals(row.contact, "opsec-coalition@example.org");
  const rev1 = (await h.db.revisions.get(row.id, 1))!;
  assertEquals(rev1.sections.hard_req, row.sections.hard_req);
  assertEquals(rev1.milestones.length, 3);
  const pledges = await h.db.pledges.list(row.id);
  assertEquals(pledges.map((p) => [p.company, p.amountUsd, p.status, p.url, p.logoCid]), [
    ["Acme Labs", 20000, "pledged", "https://acme.example/", cid],
  ]);
  // the proposer sees their private fields; the public page never does
  const mine = await j(await h.req("/api/initiatives/" + out.slug, { token })) as Out;
  assertEquals(mine.initiative.structured, true);
  assertEquals(mine.initiative.contact, "opsec-coalition@example.org");
  assertEquals((mine.initiative.sections as Record<string, string>).why, row.sections.why);
  const admin = await h.mint(ADMIN, true);
  await h.req(`/api/admin/initiatives/${row.id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  const pub = await j(await h.req("/api/initiatives/" + out.slug)) as Out;
  assertEquals(pub.initiative.structured, true);
  assertEquals("contact" in pub.initiative, false);
  assertEquals("funders" in pub.initiative, false);
  const rev = await j(await h.req(`/api/initiatives/${out.slug}/revisions/1`)) as {
    revision: { structured: boolean; links: string[]; details: string };
  };
  assertEquals(rev.revision.structured, true);
  assertEquals(rev.revision.links.length, 2);
  h.close();
});

Deno.test("submit: a missing section and a bad sum come back as findings, nothing is written", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const good = minimalSubmission(1000);
  const { hard_req: _h, ...sections } = good.sections;
  const res = await submit(h, token, {
    ...good,
    sections,
    milestones: [{ ...good.milestones[0], amount: 900 }],
  });
  assertEquals(res.status, 400);
  const body = await j(res) as unknown as Fail;
  assertEquals(body.error, "Please fix the problems marked on the form.");
  const missing = body.findings.errors.find((e) => e.field === "hard_req")!;
  assertEquals(missing.kind, "missing");
  assertStringIncludes(missing.msg, "Hard requirements is required");
  const sum = body.findings.errors.find((e) => e.field === "goal")!;
  assertEquals(sum.kind, "content");
  assertStringIncludes(sum.msg, "Milestone amounts total $900, the funding goal is $1,000");
  assertEquals((await h.db.rfps.list(["pending", "approved", "rejected", "archived"])).length, 0);
  // a legacy details-only payload is a form with nothing answered
  const legacy = await submit(h, token, {
    title: good.title,
    summary: good.summary,
    goal: "1000",
    funders: good.funders,
    details: "## Why this matters\n\nAll of it in one blob.",
  });
  assertEquals(legacy.status, 400);
  const lf = (await j(legacy) as unknown as Fail).findings.errors;
  assert(fields(lf).includes("why"));
  assert(fields(lf).includes("milestones"));
  assert(fields(lf).includes("duration_months"));
  h.close();
});

Deno.test("submit: an all-done top-up needs no adoption milestone and warns instead", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const good = minimalSubmission(1000, "grant");
  const res = await submit(h, token, {
    ...good,
    topup: true,
    milestoneReviewer: "The reviewer",
    milestones: [{ ...good.milestones[0], adoption: false, done: true, link: "" }],
  });
  assertEquals(res.status, 201);
  const out = await j(res) as { slug: string; warnings: Finding[] };
  assertEquals(fields(out.warnings).sort(), ["backers", "ms_0_link"]);
  const row = (await h.db.rfps.bySlug(out.slug))!;
  assertEquals([row.type, row.topup, row.milestoneReviewer], ["grant", true, "The reviewer"]);
  assertEquals(row.recipientTeam, "Team X");
  assertEquals(row.milestones[0].done, true);
  h.close();
});

Deno.test("submit: the same text twice is refused, whatever the first copy's status", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const good = minimalSubmission(1000);
  const first = await submit(h, token, good);
  assertEquals(first.status, 201);
  const { slug } = await j(first) as { slug: string };
  await h.db.rfps.update((await h.db.rfps.bySlug(slug))!.id, { status: "rejected" });
  const again = await submit(h, token, {
    ...good,
    title: "Another title for the same text",
    sections: Object.fromEntries(
      Object.entries(good.sections).map(([k, v]) => [k, "  " + v.toUpperCase() + "\n"]),
    ),
  });
  assertEquals(again.status, 400);
  const body = await j(again) as unknown as Fail;
  assertEquals(body.findings.errors.map((e) => e.field), [""]);
  assertStringIncludes(
    body.findings.errors[0].msg,
    'This exact text is already submitted ("A proper initiative title"). Edit it before submitting again.',
  );
  h.close();
});

Deno.test("submit: links must be https; the body has a byte cap", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const good = minimalSubmission(1000);
  const bad = await submit(h, token, {
    ...good,
    links: ["http://x.example/", "javascript:alert(1)", "https://ok.example/"],
  });
  assertEquals(bad.status, 400);
  assertEquals(fields((await j(bad) as unknown as Fail).findings.errors), ["links_0", "links_1"]);
  const big = await submit(h, token, {
    ...good,
    sections: Object.fromEntries(SECTIONS.rfp.map((k) => [k, "x".repeat(LIMITS.SECTION_CHARS)])),
  });
  assertEquals(big.status, 400);
  const bf = (await j(big) as unknown as Fail).findings.errors;
  assertEquals(bf.map((e) => [e.field, e.msg]), [["", TOO_LONG_MSG]]);
  // too many links is one finding, not twenty-one
  const many = await submit(h, token, {
    ...good,
    links: Array.from({ length: LIMITS.LINKS + 1 }, (_, i) => `https://l${i}.example/`),
  });
  assertEquals(fields((await j(many) as unknown as Fail).findings.errors), ["links"]);
  h.close();
});

Deno.test("uploads: auth, disabled, junk, ok, rate limit; a CID someone else pinned is refused", async () => {
  const off = await harness();
  assertEquals((await uploadLogo(off, "")).status, 401);
  const offToken = await off.mint(PLAIN);
  const disabled = await uploadLogo(off, offToken);
  assertEquals(disabled.status, 503);
  assertEquals((await j(disabled)).error, "Uploads are not enabled.");
  off.close();

  const h = await pinataHarness();
  const token = await proposerToken(h);
  const junk = await uploadLogo(h, token, new Uint8Array(16));
  assertEquals(junk.status, 400);
  const empty = new FormData();
  assertEquals(
    (await h.req("/api/uploads/logo", { method: "POST", token, body: empty })).status,
    400,
  );
  const ok = await uploadLogo(h, token);
  assertEquals(ok.status, 200);
  const up = await j(ok) as { cid: string; logoUrl: string };
  assert(up.cid.startsWith("bafylogo"));
  assertStringIncludes(up.logoUrl, "gateway.pinata.cloud/ipfs/" + up.cid);
  const receipt = (await h.kv.get<{ address: string }>(["upload", up.cid])).value;
  assertEquals(receipt?.address, PLAIN);
  // the junk and the empty form counted too: 12 an hour, then 429
  for (let i = 0; i < 9; i++) assertEquals((await uploadLogo(h, token)).status, 200);
  assertEquals((await uploadLogo(h, token)).status, 429);
  h.clock.now += 3601;
  assertEquals((await uploadLogo(h, token)).status, 200);

  // another wallet's receipt, a made-up CID, and a malformed one all fail the backer row
  const other = await proposerToken(h, OTHER);
  const good = minimalSubmission(1000);
  for (const logoCid of [up.cid, "bafy" + "z".repeat(50), "not a cid"]) {
    const res = await submit(h, other, {
      ...good,
      backers: [{ org: "Acme", amountUsd: 100, url: "", logoCid }],
    });
    assertEquals(res.status, 400);
    const errs = (await j(res) as unknown as Fail).findings.errors;
    assertEquals(errs.map((e) => [e.field, e.msg]), [["bk_logo_0", "Upload the logo again."]]);
  }
  h.close();
});

Deno.test("proposer edit: structured revisions, unchanged, legacy body on a structured row", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const good = minimalSubmission(1000);
  const { slug } = await j(await submit(h, token, good)) as { slug: string };
  const post = (json: unknown) =>
    h.req(`/api/initiatives/${slug}/revisions`, { method: "POST", token, json });
  const edited = await post({
    ...good,
    sections: { ...good.sections, why: "A better reason." },
    links: ["https://ref.example/"],
  });
  assertEquals(edited.status, 201);
  const out = await j(edited) as unknown as Out & { revision: { n: number } };
  assertEquals(out.revision.n, 2);
  assertEquals(out.warnings, []);
  assertEquals((out.initiative.sections as Record<string, string>).why, "A better reason.");
  const rev2 = (await h.db.revisions.get((await h.db.rfps.bySlug(slug))!.id, 2))!;
  assertEquals(rev2.links, ["https://ref.example/"]);
  assertEquals(rev2.details, "");
  // the same text again, keys reordered and padded: nothing changed
  const same = await post({
    ...good,
    links: ["https://ref.example/"],
    sections: { hard_req: "Answered.", ...good.sections, why: "  A better reason.\n" },
    milestones: good.milestones,
  });
  assertEquals(same.status, 400);
  assertEquals((await j(same)).error, "Nothing changed.");
  // the edit scope blocks on the text rules: a missing section, a sum off the stored goal
  const broken = await post({ ...good, sections: { why: "Only this one." } });
  assertEquals(broken.status, 400);
  const bf = (await j(broken) as unknown as Fail).findings.errors;
  assert(fields(bf).includes("in_scope"));
  const sum = await post({ ...good, milestones: [{ ...good.milestones[0], amount: 500 }] });
  assertEquals(fields((await j(sum) as unknown as Fail).findings.errors), ["goal"]);
  // a legacy body cannot downgrade a structured row
  const legacy = await post({ title: good.title, summary: good.summary, details: "One blob." });
  assertEquals(legacy.status, 400);
  assertEquals(
    (await j(legacy)).error,
    "This initiative uses sections; send sections, milestones and links.",
  );
  assertEquals((await h.db.rfps.bySlug(slug))!.revision, 2);
  h.close();
});

Deno.test("proposer edit: a legacy row keeps taking details, and can be upgraded", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const row = await h.db.rfps.insert({
    title: "Imported long ago",
    summary: "This summary is comfortably longer than the forty character minimum required.",
    details: "## Old\n\nLegacy text.",
    proposer: PLAIN,
    status: "approved",
    goalUsd: 1000,
  });
  const post = (json: unknown) =>
    h.req(`/api/initiatives/${row.slug}/revisions`, { method: "POST", token, json });
  const legacy = await post({ title: row.title, summary: row.summary, details: "Newer text." });
  assertEquals(legacy.status, 201);
  assertEquals((await h.db.rfps.get(row.id))!.details, "Newer text.");
  const good = minimalSubmission(1000);
  const upgraded = await post({ ...good, title: row.title, summary: row.summary });
  assertEquals(upgraded.status, 201);
  const out = await j(upgraded) as Out;
  assertEquals(out.initiative.structured, true);
  assertEquals(out.initiative.details, "");
  assertEquals((await h.db.rfps.get(row.id))!.revision, 3);
  h.close();
});

Deno.test("proposer PATCH: page facts while pending, locked after approval, admin always", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const { slug } = await j(await submit(h, token, minimalSubmission(1000))) as { slug: string };
  const patch = (json: unknown, t = token) =>
    h.req(`/api/initiatives/${slug}`, { method: "PATCH", token: t, json });
  assertEquals((await patch({ goal: "2,000" }, "")).status, 401);
  assertEquals((await patch({ goal: "2,000" }, await h.mint(OTHER))).status, 404);
  const ok = await patch({
    goal: "2,000",
    type: "grant",
    recipientTeam: "Team Q",
    recipientUrl: "https://q.example/",
    durationMonths: "9",
    contact: "new@example.com",
    funders: "A different funder list here",
  });
  assertEquals(ok.status, 200);
  const out = await j(ok) as Out;
  assertEquals(out.initiative.goalUsd, 2000);
  assertEquals(out.initiative.type, "grant");
  assertEquals(out.initiative.recipientTeam, "Team Q");
  assertEquals(out.initiative.durationMonths, 9);
  assertEquals(out.initiative.contact, "new@example.com");
  assertEquals(out.initiative.funders, "A different funder list here");
  assertEquals((await patch({ durationMonths: "1.5" })).status, 400);
  assertEquals((await patch({ recipientUrl: "http://q.example/" })).status, 400);
  // the text is untouched: no revision for a facts change
  const row = (await h.db.rfps.bySlug(slug))!;
  assertEquals(row.revision, 1);
  await h.req(`/api/admin/initiatives/${row.id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  const locked = await patch({ goal: "3,000" });
  assertEquals(locked.status, 403);
  assertEquals((await j(locked)).error, "Locked after approval; email the team.");
  assertEquals((await h.db.rfps.bySlug(slug))!.goalUsd, 2000);
  assertEquals((await patch({ goal: "3,000" }, admin)).status, 200);
  assertEquals((await h.db.rfps.bySlug(slug))!.goalUsd, 3000);
  h.close();
});

Deno.test("admin PATCH: findings without blocking, details XOR sections, type switch, hard rules", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const good = minimalSubmission(1000, "grant");
  const { slug } = await j(await submit(h, token, good)) as { slug: string };
  const id = (await h.db.rfps.bySlug(slug))!.id;
  const patch = (json: unknown) =>
    h.req(`/api/admin/initiatives/${id}`, { method: "PATCH", token: admin, json });
  // a section removed: saved, reported
  const { team: _t, ...sections } = good.sections;
  const res = await patch({ sections });
  assertEquals(res.status, 200);
  const out = await j(res) as Out;
  assertEquals(fields(out.findings!.errors), ["team"]);
  assertEquals("team" in (out.initiative.sections as object), false);
  assertEquals((await h.db.rfps.get(id))!.revision, 2);
  // a no-op save is fine and still lists the findings
  const again = await j(await patch({ sections })) as Out;
  assertEquals(fields(again.findings!.errors), ["team"]);
  assertEquals((await h.db.rfps.get(id))!.revision, 2);
  // both bodies at once
  const both = await patch({ details: "A blob.", sections: good.sections });
  assertEquals(both.status, 400);
  assertEquals((await j(both)).error, "Send either details or sections, not both.");
  // shape rules block: a non-https milestone link, a bad month, too many milestones
  const link = await patch({
    milestones: [{ ...good.milestones[0], link: "http://x.example/", month: "11/2026" }],
  });
  assertEquals(link.status, 400);
  assertEquals(fields((await j(link) as unknown as Fail).findings.errors), [
    "ms_0_link",
    "ms_0_month",
  ]);
  const many = await patch({
    milestones: Array.from({ length: LIMITS.MILESTONES + 1 }, () => good.milestones[0]),
  });
  assertEquals(fields((await j(many) as unknown as Fail).findings.errors), ["milestones"]);
  // a type switch re-cuts the body for the new type and revisions it
  const switched = await j(await patch({ type: "rfp" })) as Out;
  assertEquals(Object.keys(switched.initiative.sections as object).sort(), [
    "in_scope",
    "out_scope",
    "why",
  ]);
  assert(fields(switched.findings!.errors).includes("hard_req"));
  const row = (await h.db.rfps.get(id))!;
  assertEquals([row.type, row.revision, row.recipientTeam], ["rfp", 3, ""]);
  // a legacy row: text edits stay legacy, findings are empty
  const legacy = await h.db.rfps.insert({
    title: "Legacy initiative",
    summary: "This summary is comfortably longer than the forty character minimum required.",
    details: "Legacy body.",
    status: "approved",
  });
  const lp = await j(
    await h.req(`/api/admin/initiatives/${legacy.id}`, {
      method: "PATCH",
      token: admin,
      json: { details: "Legacy body, edited." },
    }),
  ) as Out;
  assertEquals(lp.findings, { errors: [], warnings: [] });
  assertEquals(lp.initiative.structured, false);
  assertEquals(lp.initiative.details, "Legacy body, edited.");
  const asRfp: Rfp = (await h.db.rfps.get(legacy.id))!;
  assertEquals(asRfp.revision, 2);
  h.close();
});
