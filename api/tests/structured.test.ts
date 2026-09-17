/** Structured initiatives: submit, logo uploads, proposer edits and page
 * facts, the admin editor's findings. */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import {
  ADMIN,
  deploySafe,
  type Harness,
  harness,
  j,
  PLAIN,
  proposerToken,
} from "./app-helpers.ts";
import { exampleSubmission, grantBody, minimalSubmission } from "./fixtures.ts";
import { LIMITS, SECTIONS, TOO_LONG_MSG, tooLong } from "../../shared/draft/mod.ts";
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
  await deploySafe(h, admin, row.id);
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

Deno.test("submit: rejected proposals still block the same text", async () => {
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
    'The section text and milestone names and criteria match an existing submission ("A proper initiative title"). Revise that content before submitting again; changing only the title does not make it a new submission.',
  );
  h.close();
});

Deno.test("submit: renaming a duplicate explains the match; revising its section text permits submission", async () => {
  const h = await harness();
  try {
    const token = await proposerToken(h);
    const original = {
      ...minimalSubmission(1000),
      title: "Open Source Ethereum Security Monitor",
    };
    assertEquals((await submit(h, token, original)).status, 201);

    const renamed = { ...original, title: "Ethereum Security Monitor - test" };
    const duplicate = await submit(h, token, renamed);
    assertEquals(duplicate.status, 400);
    const { findings } = await j(duplicate) as unknown as Fail;
    assertEquals(fields(findings.errors), [""]);
    assertStringIncludes(findings.errors[0].msg, original.title);
    assertStringIncludes(findings.errors[0].msg, "section text and milestone names and criteria");
    assertStringIncludes(findings.errors[0].msg, "changing only the title");
    assertEquals((await h.db.rfps.list(["pending"])).length, 1);

    const revised = await submit(h, token, {
      ...renamed,
      sections: { ...renamed.sections, why: "A revised reason for funding this security monitor." },
    });
    assertEquals(revised.status, 201);
    const { slug } = await j(revised) as { slug: string };
    assertEquals((await h.db.rfps.bySlug(slug))!.title, renamed.title);
    assertEquals((await h.db.rfps.list(["pending"])).length, 2);
  } finally {
    h.close();
  }
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
  // a criterion past the cap is refused on its own row, never silently cut
  const longCrit = await submit(h, token, {
    ...good,
    milestones: [{
      ...good.milestones[0],
      criteria: ["x".repeat(400), "y".repeat(LIMITS.CRITERION_CHARS + 1)],
    }],
  });
  assertEquals(longCrit.status, 400);
  assertEquals(fields((await j(longCrit) as unknown as Fail).findings.errors), ["ms_0_c1"]);
  // the page and private fields and backer names: refused on their own id, never cut
  const longFields = await submit(h, token, {
    ...good,
    title: "t".repeat(LIMITS.TITLE_CHARS + 1),
    contact: "c".repeat(LIMITS.CONTACT_CHARS + 1),
    backers: [{ org: "o".repeat(LIMITS.BACKER_ORG + 1), amountUsd: "1", url: "" }],
  });
  assertEquals(longFields.status, 400);
  assertEquals(
    fields((await j(longFields) as unknown as Fail).findings.errors).sort(),
    ["bk_org_0", "contact", "title"],
  );
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
  assertStringIncludes(up.logoUrl, "ipfs.blossom.software/ipfs/" + up.cid);
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
  // a fact past its cap is refused, not cut
  const longContact = await patch({ contact: "c".repeat(LIMITS.CONTACT_CHARS + 1) });
  assertEquals(longContact.status, 400);
  assertEquals((await j(longContact)).error, "The contact is too long (200 characters at most).");
  assertEquals((await patch({ contact: "c".repeat(LIMITS.CONTACT_CHARS) })).status, 200);
  // the text is untouched: no revision for a facts change
  const row = (await h.db.rfps.bySlug(slug))!;
  assertEquals(row.revision, 1);
  await deploySafe(h, admin, row.id);
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

Deno.test("bulk admin actions: initiatives and comments, per-id failures reported", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const a = await h.db.rfps.insert({ title: "Bulk one here", status: "pending" });
  const b = await h.db.rfps.insert({ title: "Bulk two here", status: "pending" });
  await deploySafe(h, admin, a.id);
  await deploySafe(h, admin, b.id);
  const res = await j(
    await h.req("/api/admin/initiatives/bulk", {
      method: "POST",
      token: admin,
      json: { ids: [a.id, b.id, "nope", a.id], action: "approve" },
    }),
  ) as { done: number; failed: { id: string; error: string }[] };
  assertEquals(res.done, 2);
  assertEquals(res.failed, [{ id: "nope", error: "not found" }]);
  assertEquals((await h.db.rfps.get(a.id))!.status, "approved");
  assert((await h.db.rfps.get(b.id))!.approvedAt);
  const arch = await j(
    await h.req("/api/admin/initiatives/bulk", {
      method: "POST",
      token: admin,
      json: { ids: [a.id, b.id], action: "archive" },
    }),
  ) as { done: number };
  assertEquals(arch.done, 2);
  assertEquals((await h.db.rfps.get(b.id))!.status, "archived");
  for (const json of [{ ids: [a.id], action: "delete" }, { ids: [], action: "approve" }]) {
    assertEquals(
      (await h.req("/api/admin/initiatives/bulk", { method: "POST", token: admin, json })).status,
      400,
    );
  }
  assertEquals(
    (await h.req("/api/admin/initiatives/bulk", {
      method: "POST",
      json: { ids: [a.id], action: "approve" },
    })).status,
    401,
  );

  // comments: publish two held ones at once, "feature" is not a bulk action
  const heldQ = (body: string) => ({
    rfpId: a.id,
    parentId: null,
    type: "question" as const,
    topic: "",
    body,
    displayName: "Someone",
    email: "",
    address: "",
    roles: [],
    status: "held" as const,
    aiSummary: "",
  });
  const c1 = await h.db.comments.create(heldQ("One held"));
  const c2 = await h.db.comments.create(heldQ("Two held"));
  const pub = await j(
    await h.req("/api/admin/comments/bulk", {
      method: "POST",
      token: admin,
      json: { ids: [c1.id, c2.id, "missing"], action: "publish" },
    }),
  ) as { done: number; failed: { id: string }[] };
  assertEquals(pub.done, 2);
  assertEquals(pub.failed.map((f) => f.id), ["missing"]);
  assertEquals((await h.db.comments.get(c1.id))!.status, "published");
  assertEquals(
    (await h.req("/api/admin/comments/bulk", {
      method: "POST",
      token: admin,
      json: { ids: [c1.id], action: "feature" },
    })).status,
    400,
  );
  h.close();
});

Deno.test("GET /initiative/<slug>.md: the content-file shape, public rows only, round-trips", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const { loadContentFiles, seedContentLogos } = await import("./app-helpers.ts");
  await seedContentLogos(h);
  await h.req("/api/admin/sync-content", {
    method: "POST",
    token: admin,
    json: { files: await loadContentFiles() },
  });
  const first = (await h.db.rfps.list(["approved"])).find((r) => r.type === "rfp")!;
  await h.req(`/api/admin/initiatives/${first.id}/pledges`, {
    method: "POST",
    token: admin,
    json: { company: "Argot Collective", amountUsd: "151000", url: "https://argot.org/" },
  });
  const res = await h.req(`/initiative/${first.slug}.md`);
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/markdown");
  const md = await res.text();
  assertStringIncludes(md, `title: ${first.title}`);
  assertStringIncludes(md, `goal: ${first.goalUsd}`);
  assertStringIncludes(md, "## Why this matters");
  assertStringIncludes(md, "## Milestones");
  assertStringIncludes(md, "backers:\n  Argot Collective | $151000 | https://argot.org/");
  // what comes out goes back in unchanged
  const { parseRfpFile } = await import("../services/content.ts");
  const again = parseRfpFile(md);
  assertEquals(again.sections, first.sections);
  assertEquals(again.milestones, first.milestones);
  assertEquals(again.links, first.links);
  assertEquals(again.goalUsd, first.goalUsd);
  assertEquals(again.backers.map((b) => b.org), ["Argot Collective"]);
  // pending rows and unknown slugs are 404; the path shape is strict
  const pending = await h.db.rfps.insert({ title: "Hidden pending one", status: "pending" });
  assertEquals((await h.req(`/initiative/${pending.slug}.md`)).status, 404);
  assertEquals((await h.req(`/initiative/nope.md`)).status, 404);
  assertEquals((await h.req(`/initiative/${first.slug}`)).status, 404);
  h.close();
});

Deno.test("<slug>-PRIVATE.md: admins only, any status, carries contact and funders; admin API by slug", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const plain = await h.mint(PLAIN, false);
  const row = await h.db.rfps.insert({
    title: "Pending private one",
    status: "pending",
    contact: "griff@example.com",
    funders: "Some L2 | why | none | no | $50k\nA wallet co | why | met once | yes | $20k",
    proposer: PLAIN,
  });
  assertEquals((await h.req(`/initiative/${row.slug}-PRIVATE.md`)).status, 401);
  assertEquals((await h.req(`/initiative/${row.slug}-PRIVATE.md`, { token: plain })).status, 403);
  const res = await h.req(`/initiative/${row.slug}-PRIVATE.md`, { token: admin });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const md = await res.text();
  assertStringIncludes(md, "status: pending");
  assertStringIncludes(md, `proposer: ${PLAIN}`);
  assertStringIncludes(md, "contact: griff@example.com");
  assertStringIncludes(md, "funders:\n  Some L2 | why | none | no | $50k\n  A wallet co |");
  // the public file never carries them, and hides the pending row anyway
  assertEquals((await h.req(`/initiative/${row.slug}.md`)).status, 404);
  await h.db.rfps.update(row.id, { status: "approved" });
  const pub = await (await h.req(`/initiative/${row.slug}.md`)).text();
  assertFalse(pub.includes("contact:"));
  assertFalse(pub.includes("funders:"));
  assertFalse(pub.includes("griff@example.com"));
  // admin JSON routes take the slug as well as the id
  const bySlug = await h.req(`/api/admin/initiatives/${row.slug}`, { token: admin });
  assertEquals(bySlug.status, 200);
  assertEquals(((await bySlug.json()) as { initiative: { id: string } }).initiative.id, row.id);
  h.close();
});

Deno.test("content logos: pinned once by name, mapped onto the pledge by the sync", async () => {
  let pins = 0;
  const h = await harness({
    env: { PINATA_JWT: "jwt-test" },
    fetch: (url) => {
      if (url.startsWith("https://uploads.pinata.cloud/")) {
        pins++;
        return new Response(JSON.stringify({ data: { cid: "bafy" + "logo".repeat(9) + pins } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not mocked", { status: 500 });
    },
  });
  const admin = await h.mint(ADMIN, true);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const upload = (name: string, bytes: Uint8Array) => {
    const form = new FormData();
    form.set("name", name);
    form.set("image", new Blob([bytes as BlobPart], { type: "image/png" }), name);
    return h.req("/api/admin/logos", { method: "POST", token: admin, body: form });
  };
  const first = await j(await upload("argot.png", png)) as { cid: string; reused: boolean };
  assertEquals(first.reused, false);
  const again = await j(await upload("argot.png", png)) as { cid: string; reused: boolean };
  assertEquals(again, { ...again, cid: first.cid, reused: true });
  assertEquals(pins, 1);
  assertEquals((await upload("Bad Name.png", png)).status, 400);
  assertEquals((await upload("argot.png", new Uint8Array([1, 2, 3]))).status, 400); // not an image

  const file = (logo: string) =>
    "---\ntitle: Logo grant here\ntype: grant\ngoal: 100\nrecipient: T\nbackers:\n" +
    `  Argot Collective | $50 | https://argot.org/${logo ? " | " + logo : ""}\n---\n` +
    grantBody(100);
  const ok = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: { files: [{ name: "logo-grant.md", text: file("argot.png") }] },
    }),
  ) as { created: number; errors: string[] };
  assertEquals(ok.errors, []);
  const rfp = (await h.db.rfps.bySlug("logo-grant"))!;
  const pledges = await h.db.pledges.list(rfp.id);
  assertEquals(pledges.length, 1);
  assertEquals(pledges[0].logoCid, first.cid);
  // a line without a logo keeps it; an unknown logo name is an error for that file
  const keep = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: { files: [{ name: "logo-grant.md", text: file("") }] },
    }),
  ) as { errors: string[] };
  assertEquals(keep.errors, []);
  assertEquals((await h.db.pledges.list(rfp.id))[0].logoCid, first.cid);
  const missing = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: { files: [{ name: "logo-grant.md", text: file("nope.png") }] },
    }),
  ) as { errors: string[] };
  assertStringIncludes(missing.errors[0], "logo nope.png is not uploaded yet");
  h.close();
});

Deno.test("pledge edit: PATCH takes the same fields as adding, including a new logo", async () => {
  const h = await harness({
    env: { PINATA_JWT: "jwt-test" },
    fetch: (url) =>
      url.startsWith("https://uploads.pinata.cloud/")
        ? new Response(JSON.stringify({ data: { cid: "bafy" + "edit".repeat(10) } }), {
          headers: { "Content-Type": "application/json" },
        })
        : new Response("not mocked", { status: 500 }),
  });
  const admin = await h.mint(ADMIN, true);
  const rfp = await h.db.rfps.insert({ title: "Pledge edit here", status: "approved" });
  const base = `/api/admin/initiatives/${rfp.slug}/pledges`;
  const created = await j(
    await h.req(base, { method: "POST", token: admin, json: { company: "Acme", amount: "1000" } }),
  ) as { pledge: { id: string } };
  const pid = created.pledge.id;
  const edited = await j(
    await h.req(`${base}/${pid}`, {
      method: "PATCH",
      token: admin,
      json: { company: "Acme Security", amount: "2,500", url: "https://acme.example/", note: "n" },
    }),
  ) as {
    pledge: { company: string; amountUsd: number; url: string; note: string; status: string };
  };
  assertEquals(edited.pledge.company, "Acme Security");
  assertEquals(edited.pledge.amountUsd, 2500);
  assertEquals(edited.pledge.url, "https://acme.example/");
  assertEquals(edited.pledge.status, "pledged");
  // status alone still works, and a javascript: link is dropped
  await h.req(`${base}/${pid}`, { method: "PATCH", token: admin, json: { status: "received" } });
  const bad = await j(
    await h.req(`${base}/${pid}`, { method: "PATCH", token: admin, json: { url: "javascript:x" } }),
  ) as { pledge: { url: string; status: string } };
  assertEquals(bad.pledge.url, "");
  assertEquals(bad.pledge.status, "received");
  // multipart with a logo re-pins and keeps the other fields
  const form = new FormData();
  form.set("note", "with logo");
  form.set(
    "image",
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) as BlobPart]),
  );
  form.set(
    "logo",
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) as BlobPart], {
      type: "image/png",
    }),
    "l.png",
  );
  const withLogo = await j(
    await h.req(`${base}/${pid}`, { method: "PATCH", token: admin, body: form }),
  ) as { pledge: { company: string; note: string; logoUrl: string } };
  assertEquals(withLogo.pledge.company, "Acme Security");
  assertEquals(withLogo.pledge.note, "with logo");
  assertStringIncludes(withLogo.pledge.logoUrl, "bafyedit");
  assertEquals(
    (await h.req(`${base}/${pid}`, { method: "PATCH", token: admin, json: { amount: "-1" } }))
      .status,
    400,
  );
  assertEquals(
    (await h.req(`${base}/nope`, { method: "PATCH", token: admin, json: { note: "x" } })).status,
    404,
  );
  h.close();
});

Deno.test("edit: a top-up measures the adoption floor against the goal minus the stored pledges", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  // ethdebug in solc, 2026-09-15: goal 281,000, Argot committed 150,000
  const good = minimalSubmission(281_000, "grant");
  const ms = (build: number, adoption: number) => [
    {
      name: "Build",
      amount: build,
      adoption: false,
      done: true,
      link: "https://x.org/a",
      month: "",
      criteria: ["Merged."],
    },
    {
      name: "Adoption",
      amount: adoption,
      adoption: true,
      done: false,
      link: "",
      month: "2027-06",
      criteria: ["Used."],
    },
  ];
  const res = await submit(h, token, {
    ...good,
    topup: true,
    milestoneReviewer: "The reviewer",
    backers: [{ org: "Argot", amountUsd: 150_000, url: "" }],
    milestones: ms(236_000, 45_000),
  });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const id = (await h.db.rfps.bySlug(slug))!.id;
  const post = (json: unknown) =>
    h.req(`/api/initiatives/${slug}/revisions`, { method: "POST", token, json });
  const patch = (json: unknown) =>
    h.req(`/api/admin/initiatives/${id}`, { method: "PATCH", token: admin, json });
  const TOO_LOW = "of the $131,000 this grant raises. Raise them to at least $43,667";
  // 45,000 is 34% of the 131,000 left to raise: an edit keeps passing
  const edited = await post({
    ...good,
    sections: { ...good.sections, why: "Edited." },
    milestones: ms(236_000, 45_000),
  });
  assertEquals(edited.status, 201);
  assertEquals((await j(edited) as Out).warnings, []);
  // 40,000 is 31%: refused, and the message names the base
  const low = await post({ ...good, milestones: ms(241_000, 40_000) });
  assertEquals(low.status, 400);
  const lowErr = (await j(low) as Fail).findings.errors.find((e) => e.field === "milestones")!;
  assertStringIncludes(lowErr.msg, TOO_LOW);
  // the admin editor reports the same rule without blocking
  const ok = await j(await patch({ milestones: ms(236_000, 45_000) })) as Out;
  assertEquals(fields(ok.findings!.errors), []);
  const warned = await j(await patch({ milestones: ms(241_000, 40_000) })) as Out;
  assertStringIncludes(
    warned.findings!.errors.find((e) => e.field === "milestones")!.msg,
    TOO_LOW,
  );
  // a withdrawn pledge no longer counts: the whole goal is the base again
  const [pledge] = await h.db.pledges.list(id);
  await h.db.pledges.setStatus(id, pledge.id, "withdrawn");
  const whole = await post({ ...good, milestones: ms(236_000, 45_000) });
  assertEquals(whole.status, 400);
  assertStringIncludes(
    (await j(whole) as Fail).findings.errors.find((e) => e.field === "milestones")!.msg,
    "16% of the goal. Raise them to at least $93,667",
  );
  h.close();
});

Deno.test("caps: a long link, an edited long title and a long pledge company are refused with the message", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const longLink = "https://x.org/" + "a".repeat(LIMITS.LINK_CHARS);
  // submit: a backer link past the cap is "too long" on its row, not "not https"
  const good = minimalSubmission(1000, "grant");
  const longBacker = await submit(h, token, {
    ...good,
    backers: [{ org: "Org", amountUsd: 5, url: longLink }],
  });
  assertEquals(longBacker.status, 400);
  const bf = (await j(longBacker) as unknown as Fail).findings.errors;
  assertEquals(fields(bf), ["bk_url_0"]);
  assertEquals(bf[0].msg, tooLong("Org: the link", LIMITS.LINK_CHARS));
  // PATCH: the recipient link has the same cap as submit
  const { slug } = await j(await submit(h, token, good)) as { slug: string };
  const patched = await h.req(`/api/initiatives/${slug}`, {
    method: "PATCH",
    token,
    json: { recipientUrl: longLink },
  });
  assertEquals(patched.status, 400);
  assertStringIncludes((await j(patched)).error as string, "too long");
  assertEquals((await h.db.rfps.bySlug(slug))!.recipientUrl, "https://x.example/");
  // edit: a long title comes back painted on the field, like submit does
  const edited = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token,
    json: { ...good, title: "t".repeat(LIMITS.TITLE_CHARS + 1) },
  });
  assertEquals(edited.status, 400);
  const ef = (await j(edited) as unknown as Fail).findings.errors;
  assertEquals(fields(ef), ["title"]);
  assertEquals(ef[0].msg, tooLong("The title", LIMITS.TITLE_CHARS));
  // admin pledges: company, link and note are refused past the cap, never cut
  const id = (await h.db.rfps.bySlug(slug))!.id;
  const base = `/api/admin/initiatives/${id}/pledges`;
  const longCompany = await h.req(base, {
    method: "POST",
    token: admin,
    json: { company: "c".repeat(LIMITS.BACKER_ORG + 1), amount: "10" },
  });
  assertEquals(longCompany.status, 400);
  assertEquals((await j(longCompany)).error, tooLong("The company name", LIMITS.BACKER_ORG));
  const created = await h.req(base, {
    method: "POST",
    token: admin,
    json: { company: "c".repeat(LIMITS.BACKER_ORG), amount: "10" },
  });
  assertEquals(created.status, 201);
  const pid = (await j(created) as { pledge: { id: string } }).pledge.id;
  const longUrl = await h.req(`${base}/${pid}`, {
    method: "PATCH",
    token: admin,
    json: { url: longLink },
  });
  assertEquals(longUrl.status, 400);
  assertEquals((await j(longUrl)).error, tooLong("The link", LIMITS.BACKER_URL));
  const longNote = await h.req(`${base}/${pid}`, {
    method: "PATCH",
    token: admin,
    json: { note: "n".repeat(301) },
  });
  assertEquals(longNote.status, 400);
  assertEquals((await j(longNote)).error, tooLong("The note", 300));
  assertEquals((await h.db.pledges.list(id))[0].company, "c".repeat(LIMITS.BACKER_ORG));
  h.close();
});

Deno.test("admin editor: a field past its cap blocks the save, an editorial finding does not", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const good = minimalSubmission(1000);
  const { slug } = await j(await submit(h, token, good)) as { slug: string };
  const id = (await h.db.rfps.bySlug(slug))!.id;
  const patch = (json: unknown) =>
    h.req(`/api/admin/initiatives/${id}`, { method: "PATCH", token: admin, json });
  // a blank milestone name is editorial: reported, saved
  const blank = await patch({ milestones: [{ ...good.milestones[0], name: "" }] });
  assertEquals(blank.status, 200);
  assertEquals(fields((await j(blank) as Out).findings!.errors), ["ms_0_name"]);
  // a name past the cap is refused with the finding on its field
  const long = await patch({
    milestones: [{ ...good.milestones[0], name: "n".repeat(LIMITS.MILESTONE_NAME + 1) }],
  });
  assertEquals(long.status, 400);
  const lf = (await j(long) as unknown as Fail).findings.errors;
  assertEquals(fields(lf), ["ms_0_name"]);
  assertEquals(lf[0].msg, tooLong("Milestone A: the name", LIMITS.MILESTONE_NAME));
  assertEquals((await h.db.rfps.get(id))!.milestones[0].name, "");
  // so is a title past the cap, painted on the field like the proposer's edit
  const longTitle = await patch({ title: "t".repeat(LIMITS.TITLE_CHARS + 1) });
  assertEquals(longTitle.status, 400);
  assertEquals(fields((await j(longTitle) as unknown as Fail).findings.errors), ["title"]);
  assertEquals((await h.db.rfps.get(id))!.title, good.title);
  h.close();
});
