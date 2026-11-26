/** Waiting for a round admin: initiatives ready for the ballot, and pledges to sign (awaiting
 * requests and open pledges the chain doesn't hold), signed from the list. */
import { assertEquals } from "@std/assert";
import type { Hex } from "viem";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { pledgeChainId } from "../../shared/vote/typed-data.ts";
import { pledgeRequests } from "../services/pledge-requests.ts";
import { ADMIN_KEY, fakeChain, NOW, OTHER, roundOf, signPrepared } from "./pledge-chain.ts";

type ToSign = {
  rfpId: string;
  slug: string;
  title: string;
  pid: string;
  company: string;
  kind: string;
  amountUsd: number;
  fromUsd: number | null;
  status: string | null;
  by: string | null;
  at: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  inFlight: { hash: Hex | null } | null;
};
type Ready = {
  id: string;
  slug: string;
  pledges: { pid: string; company: string; amountUsd: number }[];
  blocker: unknown;
} & Record<string, unknown>;
type Queue = { kind: string; ready: Ready[]; toSign: ToSign[]; goals?: unknown[] };

async function setup(kind: "real" | "test" = "real") {
  const h = await harness();
  h.clock.now = NOW;
  const insert = (title: string, goalUsd: number, status: "approved" | "pending" = "approved") =>
    h.db.initiatives.insert({ title, summary: "s", status, goalUsd, type: "grant" });
  const ballot = await insert("On the ballot", 10_000);
  const ready = await insert("Ready one", 10_000);
  const below = await insert("Below the floor", 100_000);
  const pending = await insert("Pending one", 10_000, "pending");
  await h.db.initiatives.update(ready.id, { affiliations: ["Seal"] });
  const pledge = (rfpId: string, company: string, amountUsd: number, status = "pledged") =>
    h.db.pledges.add(rfpId, {
      company,
      amountUsd,
      status: status as "pledged",
      note: "",
      url: "",
      logoCid: "",
    });
  await pledge(ready.id, "Acme", 5_000);
  await pledge(ready.id, "Bolt", 1_000, "received");
  await pledge(ready.id, "Cog", 500, "withdrawn");
  await pledge(below.id, "Dune", 1_000);
  await pledge(pending.id, "Elm", 5_000);
  // "other-one" is in the round but not on the site: skipped.
  const m = roundOf(["other-one", ballot.slug], kind);
  const fake = fakeChain(m);
  h.deps.vote = { chain: fake.chain, manifest: m };
  const token = await h.mint(ADMIN, true);
  const base = kind === "real" ? "/api/admin/vote-round/queue" : "/api/admin/vote-test-round/queue";
  const queue = async (t = token) => {
    const res = await h.req(base, { token: t });
    assertEquals(res.status, 200, await res.clone().text());
    return (await j(res)) as Queue;
  };
  /** Prepare, sign with `who` and send one item of the list. */
  const sign = async (rfpId: string, pid: string, who = ADMIN_KEY) => {
    const prep = await h.req(`${base}/${rfpId}/${pid}/prepare`, {
      method: "POST",
      token,
      json: {},
    });
    assertEquals(prep.status, 200, await prep.clone().text());
    const { typed: _, ...fields } = await signPrepared(await j(prep), who);
    return await h.req(`${base}/${rfpId}/${pid}`, { method: "POST", token, json: fields });
  };
  return { h, m, token, base, ballot, ready, below, pending, pledge, queue, sign, ...fake };
}

/** A second site admin, whose wallet holds no role on the round. */
async function otherAdmin(s: Awaited<ReturnType<typeof setup>>) {
  await s.h.deps.admins.add(OTHER.address);
  return await s.h.mint(OTHER.address, true);
}

Deno.test("queue: a qualified approved initiative outside the round is ready", async () => {
  const s = await setup();
  const q = await s.queue();
  assertEquals(q.kind, "real");
  const acme = (await s.h.db.pledges.list(s.ready.id)).find((p) => p.company === "Acme")!;
  assertEquals(q.ready, [{
    id: s.ready.id,
    slug: s.ready.slug,
    title: "Ready one",
    goalUsd: 10_000,
    raisedUsd: 5_000,
    safeAddress: "",
    type: "grant",
    affiliations: ["Seal"],
    // Open pledges only: the received and the withdrawn one are left out.
    pledges: [{ pid: acme.id, company: "Acme", amountUsd: 5_000 }],
    // The real vote pays out to the Safe.
    blocker: { kind: "no-safe" },
    claim: null,
  }]);
  // A pending initiative is never ready, however much it raised.
  assertEquals(q.ready.some((r) => r.id === s.pending.id), false);
  s.h.close();
});

Deno.test("queue: an initiative under the floor is not ready", async () => {
  const s = await setup();
  const q = await s.queue();
  assertEquals(q.ready.some((r) => r.id === s.below.id), false);
  // Nor one already in the round.
  assertEquals(q.ready.some((r) => r.id === s.ballot.id), false);
  s.h.close();
});

Deno.test("queue: an open pledge missing on-chain is listed as record", async () => {
  const s = await setup();
  const missing = await s.pledge(s.ballot.id, "Zed", 300);
  const held = await s.pledge(s.ballot.id, "Yew", 200);
  const differs = await s.pledge(s.ballot.id, "Xi", 150);
  await s.pledge(s.ballot.id, "Wax", 100, "received");
  await s.pledge(s.ballot.id, "Vale", 90, "withdrawn");
  s.state.pledges.set(pledgeChainId(held.id), {
    initiativeId: 1n,
    currencyId: 0n,
    amount: 200_000_000n,
  });
  s.state.pledges.set(pledgeChainId(differs.id), {
    initiativeId: 1n,
    currencyId: 0n,
    amount: 120_000_000n,
  });
  s.state.reads.length = 0;
  const q = await s.queue();
  const item = (pid: string, company: string, amountUsd: number, fromUsd: number | null) => ({
    rfpId: s.ballot.id,
    slug: s.ballot.slug,
    title: "On the ballot",
    pid,
    company,
    kind: "record",
    amountUsd,
    fromUsd,
    status: "pledged",
    by: null,
    at: null,
    lastError: null,
    lastErrorAt: null,
    inFlight: null,
  });
  const byPid = (a: ToSign, b: ToSign) => a.pid < b.pid ? -1 : 1;
  assertEquals(
    [...q.toSign].sort(byPid),
    [item(missing.id, "Zed", 300, null), item(differs.id, "Xi", 150, 120)].sort(byPid),
  );
  // Every record read at one block.
  const blocks = new Set(s.state.reads.filter(([k]) => k === "pledge").map(([, b]) => b));
  assertEquals(blocks.size, 1);
  assertEquals([...blocks][0] !== undefined, true);
  s.h.close();
});

Deno.test("queue: a pledge with a change in flight shows once, in flight", async () => {
  const s = await setup();
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  const asked = await s.pledge(s.ballot.id, "Yew", 200);
  const other = await otherAdmin(s);
  const patch = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${asked.id}`, {
    method: "PATCH",
    token: other,
    json: { amount: "250" },
  });
  assertEquals(patch.status, 202);
  s.state.receipt = "pending";
  const a = await s.sign(s.ballot.id, row.id);
  assertEquals(a.status, 202, await a.clone().text());
  const b = await s.sign(s.ballot.id, asked.id);
  assertEquals(b.status, 202, await b.clone().text());
  const q = await s.queue();
  const mine = q.toSign.filter((t) => t.pid === row.id);
  assertEquals(mine.length, 1);
  assertEquals(mine[0].inFlight, { hash: (await j(a)).hash as Hex });
  const theirs = q.toSign.filter((t) => t.pid === asked.id);
  assertEquals(theirs.length, 1);
  assertEquals([theirs[0].kind, theirs[0].amountUsd, theirs[0].fromUsd], ["edit", 250, 200]);
  assertEquals(theirs[0].inFlight, { hash: (await j(b)).hash as Hex });
  // A second signature while one is in flight is refused.
  const again = await s.h.req(`${s.base}/${s.ballot.id}/${row.id}/prepare`, {
    method: "POST",
    token: s.token,
    json: {},
  });
  assertEquals(again.status, 409);
  s.h.close();
});

Deno.test("queue: an awaiting request is listed with who asked", async () => {
  const s = await setup();
  const other = await otherAdmin(s);
  const res = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges`, {
    method: "POST",
    token: other,
    json: { company: "Acme", amount: "700" },
  });
  assertEquals(res.status, 202);
  const { pid } = await j(res);
  const q = await s.queue();
  assertEquals(q.toSign, [{
    rfpId: s.ballot.id,
    slug: s.ballot.slug,
    title: "On the ballot",
    pid: pid as string,
    company: "Acme",
    kind: "add",
    amountUsd: 700,
    fromUsd: null,
    status: "pledged",
    by: OTHER.address,
    at: NOW,
    lastError: null,
    lastErrorAt: null,
    inFlight: null,
  }]);
  // Signed from the list: it lands, the row is saved, the request goes.
  const sent = await s.sign(s.ballot.id, pid as string);
  assertEquals(sent.status, 202, await sent.clone().text());
  const settled = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${pid}/settle`, {
    method: "POST",
    token: s.token,
    json: { hash: (await j(sent)).hash },
  });
  assertEquals((await j(settled)).state, "saved");
  assertEquals((await s.h.db.pledges.get(s.ballot.id, pid as string))?.amountUsd, 700);
  assertEquals((await s.queue()).toSign, []);
  s.h.close();
});

Deno.test("queue: on a test round requests never appear", async () => {
  const s = await setup("test");
  // On a test round a site pledge saves at once (nothing to hold) and is signed only as a
  // test record.
  const other = await otherAdmin(s);
  const res = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges`, {
    method: "POST",
    token: other,
    json: { company: "Acme", amount: "700" },
  });
  assertEquals(res.status, 201);
  const q = await s.queue();
  assertEquals(q.kind, "test");
  assertEquals(q.toSign.map((t) => [t.kind, t.company, t.by]), [["record", "Acme", null]]);
  // A test round takes an initiative without a Safe (under its placeholder).
  assertEquals(q.ready.map((r) => [r.id, r.blocker]), [[s.ready.id, null]]);
  // The real list is empty: there is no real round.
  assertEquals((await s.h.req("/api/admin/vote-round/queue", { token: s.token })).status, 503);
  s.h.close();
});

Deno.test("queue: an awaiting add whose row was saved since is signed as an edit, then cleared", async () => {
  const s = await setup();
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  // An awaiting add for a pid whose row exists now (an earlier version of it landed).
  const requests = pledgeRequests(s.h.deps);
  const d = { chain: s.chain, manifest: s.m };
  await requests.put(d, {
    rfpId: s.ballot.id,
    pid: row.id,
    change: {
      kind: "add",
      row: {
        company: "Zed Inc",
        amountUsd: 450,
        status: "pledged",
        note: "n",
        url: "",
        logoCid: "",
      },
    },
    by: OTHER.address,
    at: NOW,
  });
  const q = await s.queue();
  assertEquals(q.toSign.map((t) => [t.pid, t.kind, t.amountUsd, t.fromUsd]), [
    [row.id, "edit", 450, 300],
  ]);
  const sent = await s.sign(s.ballot.id, row.id);
  assertEquals(sent.status, 202, await sent.clone().text());
  assertEquals(s.state.sent.at(-1)!.amount, 450_000_000n);
  const settled = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${row.id}/settle`, {
    method: "POST",
    token: s.token,
    json: { hash: (await j(sent)).hash },
  });
  assertEquals((await j(settled)).state, "saved");
  const now = await s.h.db.pledges.get(s.ballot.id, row.id);
  assertEquals([now?.company, now?.amountUsd, now?.note], ["Zed Inc", 450, "n"]);
  assertEquals(await requests.get(d, s.ballot.id, row.id), null);
  assertEquals((await s.queue()).toSign, []);
  s.h.close();
});

Deno.test("queue: signing a record writes the row's amount and leaves the row as it is", async () => {
  const s = await setup();
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  const sent = await s.sign(s.ballot.id, row.id);
  assertEquals(sent.status, 202, await sent.clone().text());
  const call = s.state.sent.at(-1)!;
  assertEquals([call.pledgeId, call.initiativeId, call.amount], [
    pledgeChainId(row.id),
    1n,
    300_000_000n,
  ]);
  const settled = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${row.id}/settle`, {
    method: "POST",
    token: s.token,
    json: { hash: (await j(sent)).hash },
  });
  assertEquals((await j(settled)).state, "saved");
  assertEquals(await s.h.db.pledges.get(s.ballot.id, row.id), row);
  assertEquals((await s.queue()).toSign, []);
  // A received pledge takes nothing off the ask: nothing to sign for it.
  const paid = await s.pledge(s.ballot.id, "Wax", 100, "received");
  const prep = await s.h.req(`${s.base}/${s.ballot.id}/${paid.id}/prepare`, {
    method: "POST",
    token: s.token,
    json: {},
  });
  assertEquals(prep.status, 404);
  s.h.close();
});

Deno.test("queue: on a test round signing relays without touching the site's rows", async () => {
  const s = await setup("test");
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  const before = await s.h.db.pledges.list(s.ballot.id, true);
  const sent = await s.sign(s.ballot.id, row.id);
  assertEquals(sent.status, 202, await sent.clone().text());
  const { hash } = await j(sent);
  const call = s.state.sent.at(-1)!;
  assertEquals([call.pledgeId, call.initiativeId, call.amount, call.signer], [
    pledgeChainId(row.id),
    1n,
    300_000_000n,
    ADMIN,
  ]);
  const settled = await s.h.req(
    `/api/admin/vote-test-round/test-pledges/${s.ballot.slug}/pledges/${row.id}/settle`,
    { method: "POST", token: s.token, json: { hash } },
  );
  assertEquals((await j(settled)).state, "saved");
  assertEquals(await s.h.db.pledges.list(s.ballot.id, true), before);
  assertEquals((await s.queue()).toSign, []);
  s.h.close();
});

Deno.test("queue: after the round closes nothing is listed and nothing is signed", async () => {
  const s = await setup();
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  s.h.clock.now = s.m.closesAt;
  assertEquals(await s.queue(), { kind: "real", ready: [], toSign: [], goals: [] });
  const prep = await s.h.req(`${s.base}/${s.ballot.id}/${row.id}/prepare`, {
    method: "POST",
    token: s.token,
    json: {},
  });
  assertEquals(prep.status, 410);
  const send = await s.h.req(`${s.base}/${s.ballot.id}/${row.id}`, {
    method: "POST",
    token: s.token,
    json: { pid: row.id, nonce: "0", deadline: String(NOW + 600), signature: "0x12" },
  });
  assertEquals(send.status, 410);
  s.h.close();
});

Deno.test("queue: site admins only", async () => {
  const s = await setup();
  const plain = await s.h.mint("0x5000000000000000000000000000000000000005");
  assertEquals((await s.h.req(s.base, { token: plain })).status, 403);
  s.h.close();
});

Deno.test("queue: a held status change lists what goes on-chain, with the status", async () => {
  const s = await setup();
  const row = await s.pledge(s.ballot.id, "Zed", 20_000);
  const other = await otherAdmin(s);
  const res = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${row.id}`, {
    method: "PATCH",
    token: other,
    json: { status: "withdrawn" },
  });
  assertEquals(res.status, 202);
  const add = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges`, {
    method: "POST",
    token: other,
    json: { company: "Paid", amount: "5000", status: "received" },
  });
  assertEquals(add.status, 202);
  const q = await s.queue();
  const rows = q.toSign.map((t) => [t.company, t.kind, t.amountUsd, t.fromUsd, t.status]);
  assertEquals(rows.sort(), [
    ["Paid", "add", 0, null, "received"],
    ["Zed", "edit", 0, 20_000, "withdrawn"],
  ]);
  s.h.close();
});

Deno.test("queue: a held edit of a pledge that is gone is not listed", async () => {
  const s = await setup();
  const requests = pledgeRequests(s.h.deps);
  const d = { chain: s.chain, manifest: s.m };
  await requests.put(d, {
    rfpId: s.ballot.id,
    pid: "01JGONE0000000000000000000",
    change: { kind: "edit", patch: { amountUsd: 10 } },
    by: OTHER.address,
    at: NOW,
  });
  assertEquals((await s.queue()).toSign, []);
  s.h.close();
});

Deno.test("queue: a request whose signed send failed lists the reason", async () => {
  const s = await setup();
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  const other = await otherAdmin(s);
  const res = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${row.id}`, {
    method: "PATCH",
    token: other,
    json: { amount: "400" },
  });
  assertEquals(res.status, 202);
  s.state.receipt = "reverted";
  const sent = await s.sign(s.ballot.id, row.id);
  assertEquals(sent.status, 202, await sent.clone().text());
  const settled = await s.h.req(`/api/admin/initiatives/${s.ballot.id}/pledges/${row.id}/settle`, {
    method: "POST",
    token: s.token,
    json: { hash: (await j(sent)).hash },
  });
  assertEquals((await j(settled)).state, "failed");
  const [t] = (await s.queue()).toSign;
  assertEquals([t.pid, t.lastError, t.lastErrorAt], [
    row.id,
    "the transaction failed on-chain",
    NOW,
  ]);
  s.h.close();
});

/** Claim or release Put on the ballot of `rfpId` for the admin of `token`. */
async function claimReq(
  s: Awaited<ReturnType<typeof setup>>,
  rfpId: string,
  token: string,
  method: "POST" | "DELETE" = "POST",
) {
  const path = s.base.replace(/\/queue$/, "/ballot-claims/") + rfpId;
  return await s.h.req(path, { method, token, ...(method === "POST" ? { json: {} } : {}) });
}

for (const kind of ["real", "test"] as const) {
  Deno.test(`ballot claim (${kind}): one admin at a time; the second is told who`, async () => {
    const s = await setup(kind);
    const other = await otherAdmin(s);
    const first = await claimReq(s, s.ready.id, s.token);
    assertEquals(first.status, 200, await first.clone().text());
    const second = await claimReq(s, s.ready.id, other);
    assertEquals(second.status, 409);
    const body = (await j(second)) as { code: string; by: string; at: number; message: string };
    assertEquals(body.code, "ballot_claimed");
    assertEquals(body.by.toLowerCase(), ADMIN.toLowerCase());
    assertEquals(body.at, NOW);
    assertEquals(body.message, `${body.by} is putting it on the ballot.`);
    // The same admin claims again (a refresh, e.g. after a reload).
    assertEquals((await claimReq(s, s.ready.id, s.token)).status, 200);
    // The queue shows who holds it.
    const q = await s.queue();
    const row = q.ready.find((r) => r.id === s.ready.id)!;
    assertEquals((row.claim as { by: string }).by.toLowerCase(), ADMIN.toLowerCase());
    assertEquals((row.claim as { at: number }).at, NOW);
    s.h.close();
  });

  Deno.test(`ballot claim (${kind}): only its holder releases it, then another can claim`, async () => {
    const s = await setup(kind);
    const other = await otherAdmin(s);
    assertEquals((await claimReq(s, s.ready.id, s.token)).status, 200);
    const refused = await claimReq(s, s.ready.id, other, "DELETE");
    assertEquals(refused.status, 409);
    assertEquals((await claimReq(s, s.ready.id, s.token, "DELETE")).status, 200);
    // Releasing what isn't held is fine.
    assertEquals((await claimReq(s, s.ready.id, s.token, "DELETE")).status, 200);
    assertEquals((await s.queue()).ready.find((r) => r.id === s.ready.id)!.claim, null);
    assertEquals((await claimReq(s, s.ready.id, other)).status, 200);
    s.h.close();
  });
}

Deno.test("ballot claim: refused once the round has closed, 404 for an unknown initiative", async () => {
  const s = await setup();
  assertEquals((await claimReq(s, "nope", s.token)).status, 404);
  s.h.clock.now = s.m.closesAt;
  assertEquals((await claimReq(s, s.ready.id, s.token)).status, 410);
  s.h.close();
});

Deno.test("ballot claim: one older than 5 minutes counts as gone, though KV still holds it", async () => {
  const s = await setup();
  const other = await otherAdmin(s);
  assertEquals((await claimReq(s, s.ready.id, s.token)).status, 200);
  // KV deletes an expired key "no earlier than" its expireIn: still there at NOW + 300.
  s.h.clock.now = NOW + 300;
  assertEquals((await s.queue()).ready.find((r) => r.id === s.ready.id)!.claim, null);
  const taken = await claimReq(s, s.ready.id, other);
  assertEquals(taken.status, 200, await taken.clone().text());
  const row = (await s.queue()).ready.find((r) => r.id === s.ready.id)!;
  assertEquals(row.claim, { by: OTHER.address, at: NOW + 300 });
  // The first admin's lapsed claim is no longer theirs.
  assertEquals((await claimReq(s, s.ready.id, s.token)).status, 409);
  s.h.close();
});

Deno.test("ballot claim: a claim 1 s short of 5 minutes still holds", async () => {
  const s = await setup();
  const other = await otherAdmin(s);
  assertEquals((await claimReq(s, s.ready.id, s.token)).status, 200);
  s.h.clock.now = NOW + 299;
  assertEquals((await claimReq(s, s.ready.id, other)).status, 409);
  s.h.close();
});

Deno.test("queue: production's fractional clock still signs a pledge", async () => {
  const s = await setup();
  // bootstrap's clock is Date.now() / 1000: seconds with a fraction (#132).
  s.h.clock.now = NOW + 0.731;
  const row = await s.pledge(s.ballot.id, "Zed", 300);
  const sent = await s.sign(s.ballot.id, row.id);
  assertEquals(sent.status, 202, await sent.clone().text());
  s.h.close();
});

for (const kind of ["real", "test"] as const) {
  Deno.test(`ballot deadline (${kind}): after it ${kind === "real" ? "nothing is ready and a claim is refused" : "the rehearsal goes on"}`, async () => {
    const s = await setup(kind);
    await s.h.deps.db.meta.set("vote_settings", {
      show: true,
      floorPct: 25,
      capUsd: 200_000,
      qualifyBy: NOW + 60,
    });
    assertEquals((await s.queue()).ready.map((r) => r.id), [s.ready.id]);
    s.h.clock.now = NOW + 60;
    const claim = await claimReq(s, s.ready.id, s.token);
    if (kind === "real") {
      assertEquals((await s.queue()).ready, []);
      assertEquals(claim.status, 409);
      assertEquals(await j(claim), {
        error: "No more initiatives can be added to the ballot.",
        code: "ballot_closed",
        message: "No more initiatives can be added to the ballot.",
      });
    } else {
      assertEquals((await s.queue()).ready.map((r) => r.id), [s.ready.id]);
      assertEquals(claim.status, 200, await claim.clone().text());
    }
    s.h.close();
  });
}
