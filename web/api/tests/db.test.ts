import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { createDb } from "../db/mod.ts";
import type { Verification } from "../chain/verify.ts";

let clock = 1_800_000_000;
const now = () => clock;

async function fresh() {
  const kv = await Deno.openKv(":memory:");
  return { kv, db: createDb(kv, now) };
}

const ok = (over: Partial<Verification> = {}): Verification => ({
  found: true,
  pending: false,
  ok: true,
  tokenSymbol: "USDC",
  tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  amountRaw: "50000000",
  amount: 50,
  amountUsd: 50,
  donor: "0x1111111111111111111111111111111111111111",
  detail: "verified",
  ...over,
});

Deno.test("rfps: slug uniqueness, lookup, list order, update guard", async () => {
  const { kv, db } = await fresh();
  const a = await db.rfps.insert({ title: "Vyper compiler formal verification" });
  clock += 10;
  const b = await db.rfps.insert({ title: "Vyper compiler formal verification" });
  assertEquals(a.slug, "vyper-compiler-formal-verification");
  assertEquals(b.slug, "vyper-compiler-formal-verification-2");
  assertEquals((await db.rfps.bySlug(b.slug))?.id, b.id);
  const listed = await db.rfps.list(["pending"]);
  assertEquals(listed.map((r) => r.id), [b.id, a.id]); // newest first
  await assertRejects(
    () => db.rfps.update(a.id, { slug: "x" } as never),
    Error,
    "not allowed",
  );
  await db.rfps.update(a.id, { status: "approved", approvedAt: now() });
  assertEquals((await db.rfps.list(["approved"])).length, 1);
  await assertRejects(
    () => db.rfps.insert({ title: "dup" }, a.slug),
    Error,
    "already exists",
  );
  kv.close();
});

Deno.test("rfps: a Safe address belongs to exactly one initiative", async () => {
  const { kv, db } = await fresh();
  const a = await db.rfps.insert({ title: "First one here" });
  const b = await db.rfps.insert({ title: "Second one here" });
  const safe = "0xD5Cf05f24727C83976652E3586c0e26DD39884e9";
  await db.rfps.update(a.id, { safeAddress: safe });
  assertEquals((await db.rfps.bySafe(safe.toLowerCase()))?.id, a.id);
  await assertRejects(
    () => db.rfps.update(b.id, { safeAddress: safe }),
    Error,
    "already assigned",
  );
  await db.rfps.update(a.id, { safeAddress: "" });
  assertEquals(await db.rfps.bySafe(safe), null);
  kv.close();
});

Deno.test("rfps: content upsert never touches lifecycle or money", async () => {
  const { kv, db } = await fresh();
  const f = {
    title: "T",
    summary: "s",
    details: "d",
    goalUsd: 100,
    discourseUrl: "",
    status: "approved" as const,
    sortRank: null,
    type: "rfp" as const,
  };
  assertEquals(await db.rfps.upsertContent("my-slug", f), "created");
  const r = (await db.rfps.bySlug("my-slug"))!;
  await db.rfps.update(r.id, {
    status: "archived",
    safeAddress: "0xD5Cf05f24727C83976652E3586c0e26DD39884e9",
  });
  assertEquals(
    await db.rfps.upsertContent("my-slug", {
      ...f,
      title: "T2",
      goalUsd: 200,
      status: "pending",
    }),
    "updated",
  );
  const r2 = (await db.rfps.bySlug("my-slug"))!;
  assertEquals(r2.title, "T2");
  assertEquals(r2.goalUsd, 200);
  assertEquals(r2.status, "archived");
  assert(r2.safeAddress);
  kv.close();
});

Deno.test("donations: one tx credits two initiatives, idempotent, pending->confirmed", async () => {
  const { kv, db } = await fresh();
  const a = await db.rfps.insert({ title: "First one here" });
  const b = await db.rfps.insert({ title: "Second one here" });
  const tx = "0x" + "ab".repeat(32);
  const [, s1] = await db.donations.record(a.id, tx, ok());
  const [, s2] = await db.donations.record(b.id, tx, ok({ amountUsd: 20 }));
  assertEquals([s1, s2], ["confirmed", "confirmed"]);
  const [, s3] = await db.donations.record(a.id, tx, ok({ amountUsd: 999 }));
  assertEquals(s3, "already-confirmed");
  assertEquals((await db.fundingSummary(a.id)).donated, 50);
  assertEquals((await db.fundingSummary(b.id)).donated, 20);
  assertEquals(
    (await db.donations.byHash(tx.toUpperCase().replace("0X", "0x")))?.amountUsd,
    50,
  );

  const tx2 = "0x" + "cd".repeat(32);
  const [, p] = await db.donations.record(
    a.id,
    tx2,
    ok({ ok: false, pending: true, amountUsd: 0 }),
  );
  assertEquals(p, "pending");
  assertEquals((await db.donations.pending()).length, 1);
  const [, c] = await db.donations.record(a.id, tx2, ok({ amountUsd: 30 }));
  assertEquals(c, "confirmed");
  assertEquals((await db.donations.pending()).length, 0);
  assertEquals(
    await db.donations.totalFor(a.id, "0x1111111111111111111111111111111111111111"),
    80,
  );
  assertEquals(
    await db.donations.totalFor(b.id, "0x2222222222222222222222222222222222222222"),
    0,
  );
  kv.close();
});

Deno.test("pledges: totals exclude withdrawn", async () => {
  const { kv, db } = await fresh();
  const r = await db.rfps.insert({ title: "First one here" });
  const p = await db.pledges.add(r.id, {
    company: "A",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  await db.pledges.add(r.id, {
    company: "B",
    amountUsd: 50,
    status: "received",
    note: "",
    url: "",
    logoCid: "",
  });
  assertEquals((await db.fundingSummary(r.id)).pledged, 150);
  await db.pledges.setStatus(r.id, p.id, "withdrawn");
  assertEquals((await db.fundingSummary(r.id)).pledged, 50);
  assertEquals((await db.pledges.list(r.id, true)).length, 2);
  await db.pledges.remove(r.id, p.id);
  assertEquals((await db.pledges.list(r.id, true)).length, 1);
  kv.close();
});

Deno.test("comments: author starting vote, toggle, switch, ordering data, claim tokens", async () => {
  const { kv, db } = await fresh();
  const r = await db.rfps.insert({ title: "First one here" });
  const base = {
    rfpId: r.id,
    parentId: null,
    type: "question" as const,
    topic: "",
    body: "b",
    displayName: "",
    email: "",
    address: "0x1111111111111111111111111111111111111111",
    roles: ["DONOR"],
    status: "published" as const,
    aiSummary: "",
  };
  const c = await db.comments.create(base, true);
  assertEquals((await db.comments.get(c.id))?.votes, 1);
  const other = await db.comments.create({ ...base, address: "" });
  assertEquals(other.votes, 0);
  // untap own vote
  assertEquals(await db.comments.setVote(c.id, base.address, 1), { myvote: 0, score: 0 });
  // downvote and switch
  assertEquals(
    await db.comments.setVote(c.id, "0x2222222222222222222222222222222222222222", -1),
    { myvote: -1, score: -1 },
  );
  assertEquals(
    await db.comments.setVote(c.id, "0x2222222222222222222222222222222222222222", 1),
    { myvote: 1, score: 1 },
  );
  assertEquals(
    await db.comments.votesByAddress(r.id, "0x2222222222222222222222222222222222222222"),
    { [c.id]: 1 },
  );
  const held = await db.comments.create({ ...base, status: "held" });
  assertEquals((await db.comments.forRfp(r.id)).length, 2);
  assertEquals((await db.comments.byClaimTokens([held.claimToken])).map((x) => x.id), [
    held.id,
  ]);
  assertEquals((await db.comments.byClaimTokens([c.claimToken])).length, 0); // published: never via token
  assertEquals((await db.comments.held()).length, 1);
  await db.comments.addReport(c.id);
  assertEquals((await db.comments.reported())[0].reports, 1);
  await db.comments.set(c.id, { featured: 2, featuredAt: now() });
  assertEquals((await db.comments.frontPage()).length, 1);
  kv.close();
});

Deno.test("profiles: nickname uniqueness is case-insensitive, pfp independent", async () => {
  const { kv, db } = await fresh();
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  assert(await db.profiles.setNickname(a, "Griff"));
  assertFalse(await db.profiles.setNickname(b, "griff"));
  assert(await db.profiles.setNickname(a, "griff")); // own rename, case only
  assert(await db.profiles.setNickname(a, "Other"));
  assertEquals(await db.profiles.nicknameOwner("griff"), null); // released
  await db.profiles.setPfp(b, "preset:3");
  assertEquals(await db.profiles.get(b), {
    nickname: "",
    pfp: "preset:3",
    updatedAt: now(),
  });
  kv.close();
});

Deno.test("sessions + nonces: single-use nonce, expiry, revoke all", async () => {
  const { kv, db } = await fresh();
  const n = await db.sessions.issueNonce();
  assert(await db.sessions.consumeNonce(n));
  assertFalse(await db.sessions.consumeNonce(n));
  const addr = "0x1111111111111111111111111111111111111111";
  const { token } = await db.sessions.create(addr, false);
  const { token: t2 } = await db.sessions.create(addr, true);
  assertEquals((await db.sessions.get(token))?.address, addr);
  assert((await db.sessions.get(t2))?.isAdmin);
  clock += 13 * 3600;
  assertEquals(await db.sessions.get(t2), null); // admin sessions last 12h
  assert(await db.sessions.get(token));
  assertEquals(await db.sessions.revokeAll(addr), 2);
  assertEquals(await db.sessions.get(token), null);
  kv.close();
});

Deno.test("rate limit windows, locks, ai budget", async () => {
  const { kv, db } = await fresh();
  assert(await db.rateLimit("x", 2, 60));
  assert(await db.rateLimit("x", 2, 60));
  assertFalse(await db.rateLimit("x", 2, 60));
  clock += 61;
  assert(await db.rateLimit("x", 2, 60));
  assert(await db.meta.lock("l", 30));
  assertFalse(await db.meta.lock("l", 30));
  await db.meta.unlock("l");
  assert(await db.meta.lock("l", 30));
  for (let i = 0; i < 500; i++) assert(await db.meta.aiBudgetOk());
  assertFalse(await db.meta.aiBudgetOk());
  kv.close();
});
