/** Admin pledges during the real vote: signed by the admin, relayed with setPledgeBySig,
 * answered with the hash right after the broadcast, saved only once the chain holds it. */
import { assertEquals } from "@std/assert";
import type { Hex } from "viem";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { pledgeChainId } from "../../shared/vote/typed-data.ts";
import { ADMIN_KEY, fakeChain, NOW, OTHER, roundOf, signPrepared } from "./pledge-chain.ts";
import { pledgeOnChain } from "../routes/admin.ts";
import { PLEDGE_ROLE_ID } from "../../shared/vote/roles.ts";
import { roundKey } from "../../shared/vote/keys.ts";
import { pledgeRequests } from "../services/pledge-requests.ts";

async function setup(kind: "real" | "test" = "real", inRound = true) {
  const h = await harness();
  h.clock.now = NOW;
  const r = await h.db.initiatives.insert({
    title: "Pledged initiative",
    summary: "s",
    status: "approved",
    goalUsd: 10_000,
  });
  const m = roundOf(inRound ? ["other-one", r.slug] : ["other-one"], kind);
  const fake = fakeChain(m);
  h.deps.vote = { chain: fake.chain, manifest: m };
  const token = await h.mint(ADMIN, true);
  const base = `/api/admin/initiatives/${r.id}`;
  return { h, r, m, token, base, ...fake };
}

async function prepare(
  s: Awaited<ReturnType<typeof setup>>,
  json: Record<string, unknown>,
  who = ADMIN_KEY,
) {
  const res = await s.h.req(`${s.base}/pledges/prepare`, {
    method: "POST",
    token: s.token,
    json,
  });
  assertEquals(res.status, 200, await res.clone().text());
  return await signPrepared(await j(res), who);
}

const ACME = { company: "Acme", amount: "500", url: "https://acme.example/" };

/** The form's call after its own wait for the receipt. */
async function settle(s: Awaited<ReturnType<typeof setup>>, pid: string, hash?: Hex | null) {
  const res = await s.h.req(`${s.base}/pledges/${pid}/settle`, {
    method: "POST",
    token: s.token,
    json: hash === undefined ? {} : { hash },
  });
  assertEquals(res.status, 200, await res.clone().text());
  return (await j(res)) as { state: string; pledge: { id: string; amountUsd: number } | null };
}

Deno.test("pledgeOnChain: the real vote, before it closes, for an initiative in the round", () => {
  const m = roundOf(["a", "b"]);
  assertEquals(pledgeOnChain(m, "b", NOW), { initiativeId: 1 });
  assertEquals(pledgeOnChain(m, "c", NOW), null);
  assertEquals(pledgeOnChain(m, "b", m.closesAt), null);
  assertEquals(pledgeOnChain(roundOf(["a", "b"], "test"), "b", NOW), null);
  assertEquals(pledgeOnChain(null, "b", NOW), null);
});

Deno.test("admin pledges: outside the real vote a pledge saves as today", async () => {
  const s = await setup("test");
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token: s.token, json: ACME });
  assertEquals(res.status, 201);
  assertEquals((await s.h.db.pledges.list(s.r.id)).length, 1);
  assertEquals(s.state.sent, []);
  const prep = await s.h.req(`${s.base}/pledges/prepare`, {
    method: "POST",
    token: s.token,
    json: ACME,
  });
  assertEquals(prep.status, 409);
  s.h.close();
});

Deno.test("admin pledges: an initiative outside the round saves as today", async () => {
  const s = await setup("real", false);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token: s.token, json: ACME });
  assertEquals(res.status, 201);
  const pid = ((await j(res)).pledge as { id: string }).id;
  const edit = await s.h.req(`${s.base}/pledges/${pid}`, {
    method: "PATCH",
    token: s.token,
    json: { status: "received" },
  });
  assertEquals(edit.status, 200);
  const del = await s.h.req(`${s.base}/pledges/${pid}`, { method: "DELETE", token: s.token });
  assertEquals(del.status, 200);
  assertEquals(s.state.sent, []);
  s.h.close();
});

Deno.test("admin pledges: during the real vote a pledge without a signature is refused and nothing is saved", async () => {
  const s = await setup();
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token: s.token, json: ACME });
  assertEquals(res.status, 428);
  assertEquals((await j(res)).code, "signature_required");
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  const p = await s.h.db.pledges.add(s.r.id, {
    company: "Old",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const edit = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "200" },
  });
  assertEquals(edit.status, 428);
  const del = await s.h.req(`${s.base}/pledges/${p.id}`, { method: "DELETE", token: s.token });
  assertEquals(del.status, 428);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 100);
  assertEquals(s.state.sent, []);
  s.h.close();
});

Deno.test("admin pledges: a signed pledge is relayed and then saved", async () => {
  const s = await setup();
  const signed = await prepare(s, ACME);
  assertEquals(signed.typed.message.amount, 500_000_000n);
  assertEquals(signed.typed.message.currencyId, 0n);
  assertEquals(signed.typed.message.initiativeId, 1n);
  assertEquals(signed.typed.message.nonce, 0n);
  assertEquals(signed.typed.message.deadline, BigInt(NOW + 600));
  assertEquals(signed.typed.message.pledgeId, pledgeChainId(signed.pid));
  const { typed: _, ...fields } = signed;
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  // Answered right after the broadcast, with the hash: the browser waits for the receipt.
  assertEquals(res.status, 202, await res.clone().text());
  assertEquals(await j(res), { hash: s.last(), pid: signed.pid });
  assertEquals(s.state.sent.length, 1);
  assertEquals(s.state.sent[0].signer.toLowerCase(), ADMIN.toLowerCase());
  assertEquals(s.state.sent[0].amount, 500_000_000n);
  const settled = await settle(s, signed.pid, s.last());
  assertEquals(settled.state, "saved");
  assertEquals(settled.pledge?.id, signed.pid);
  const saved = await s.h.db.pledges.list(s.r.id);
  assertEquals(saved.map((p) => [p.id, p.company, p.amountUsd]), [[signed.pid, "Acme", 500]]);
  s.h.close();
});

Deno.test("admin pledges: a signed pledge is answered at once, without waiting for its receipt", async () => {
  const s = await setup();
  // The receipt never arrives while the request runs.
  s.state.receipt = "pending";
  const { typed: _, ...fields } = await prepare(s, ACME);
  const t0 = Date.now();
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 202, await res.clone().text());
  assertEquals(Date.now() - t0 < 2_000, true);
  assertEquals(await j(res), { hash: s.last(), pid: fields.pid });
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  assertEquals(await settle(s, fields.pid, s.last()), { state: "pending", pledge: null });
  s.land(s.last());
  const saved = await settle(s, fields.pid, s.last());
  assertEquals(saved.state, "saved");
  assertEquals(saved.pledge?.amountUsd, 500);
  // Asked again (another tab, the page's own look): still saved, from the stored outcome.
  assertEquals((await settle(s, fields.pid, s.last())).state, "saved");
  s.h.close();
});

Deno.test("admin pledges: a pledge whose transaction reverts is not saved", async () => {
  const s = await setup();
  s.state.receipt = "reverted";
  const { typed: _, ...fields } = await prepare(s, ACME);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 202);
  assertEquals(await settle(s, fields.pid, s.last()), { state: "failed", pledge: null });
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  assertEquals((await page(s)).pendingPledges, []);
  s.h.close();
});

Deno.test("admin pledges: a pledge refused before its broadcast answers 502 and keeps nothing", async () => {
  const s = await setup();
  const { typed: _, ...fields } = await prepare(s, ACME);
  // Another signature used the nonce meanwhile: the node's gas estimate reverts.
  s.state.nonces.set(ADMIN.toLowerCase(), 1n);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 502);
  const body = await j(res);
  assertEquals(body.code, "pledge_not_recorded");
  assertEquals(String(body.error).includes("already used"), true);
  assertEquals(s.state.sent, []);
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  assertEquals((await page(s)).pendingPledges, []);
  s.h.close();
});

Deno.test("admin pledges: the same signature sent twice saves one pledge", async () => {
  const s = await setup();
  const { typed: _, ...fields } = await prepare(s, ACME);
  const send = () =>
    s.h.req(`${s.base}/pledges`, { method: "POST", token: s.token, json: { ...ACME, ...fields } });
  assertEquals((await send()).status, 202);
  assertEquals((await settle(s, fields.pid, s.last())).state, "saved");
  const first = (await s.h.db.pledges.get(s.r.id, fields.pid))!;
  s.h.clock.now += 5;
  // It landed: the saved row stands (not written again), and no second transaction.
  assertEquals((await send()).status, 201);
  assertEquals(s.state.sent.length, 1);
  assertEquals(await s.h.db.pledges.get(s.r.id, fields.pid), first);
  // An add over the saved row with other words is refused, even with the amount on-chain.
  const other = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, company: "Acme Inc", ...fields },
  });
  assertEquals(other.status, 409);
  assertEquals((await j(other)).code, "pledge_exists");
  assertEquals((await s.h.db.pledges.get(s.r.id, fields.pid))?.company, "Acme");
  assertEquals((await s.h.db.pledges.list(s.r.id)).map((p) => p.id), [fields.pid]);
  s.h.close();
});

Deno.test("admin pledges: a second signature with a used nonce fails on the nonce and saves nothing", async () => {
  const s = await setup();
  const { typed: _, ...fields } = await prepare(s, ACME);
  await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  // Both signed against the same nonce: the first to land uses it.
  const { typed: __, ...a } = await prepare(s, { pid: fields.pid, amount: "800" });
  const { typed: ___, ...b } = await prepare(s, { pid: fields.pid, amount: "900" });
  const patch = (amount: string, f: typeof a) =>
    s.h.req(`${s.base}/pledges/${fields.pid}`, {
      method: "PATCH",
      token: s.token,
      json: { amount, ...f },
    });
  assertEquals((await patch("800", a)).status, 202);
  const late = await patch("900", b);
  assertEquals(late.status, 502);
  assertEquals((await j(late)).code, "pledge_not_recorded");
  assertEquals((await s.h.db.pledges.get(s.r.id, fields.pid))?.amountUsd, 800);
  assertEquals(s.state.sent.length, 2);
  s.h.close();
});

Deno.test("admin pledges: a pledge id already used by another initiative's pledge is refused", async () => {
  const s = await setup();
  const other = await s.h.db.initiatives.insert({
    title: "Another initiative",
    summary: "s",
    status: "approved",
    goalUsd: 10_000,
  });
  const theirs = await s.h.db.pledges.add(other.id, {
    company: "Theirs",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const { typed: _, ...onSite } = await prepare(s, { ...ACME, pid: theirs.id });
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...onSite },
  });
  assertEquals(res.status, 409);
  assertEquals((await j(res)).code, "pledge_id_taken");
  // On-chain only (the site has no row for it): the contract would move it here.
  const pid = "01JOTHERCHAINPLEDGE0000000";
  s.state.pledges.set(pledgeChainId(pid), { initiativeId: 0n, currencyId: 0n, amount: 5n });
  const { typed: __, ...onChain } = await prepare(s, { ...ACME, pid });
  const res2 = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...onChain },
  });
  assertEquals(res2.status, 409);
  assertEquals((await j(res2)).code, "pledge_id_taken");
  assertEquals(s.state.sent, []);
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  s.h.close();
});

/** Add ACME with a transaction that is still pending when the request stops waiting. */
async function timedOut(s: Awaited<ReturnType<typeof setup>>) {
  s.state.receipt = "pending";
  const { typed: _, ...fields } = await prepare(s, ACME);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 202);
  const body = await j(res);
  assertEquals(body.pid, fields.pid);
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  s.state.receipt = "success";
  return { fields, hash: body.hash as Hex };
}
const page = async (s: Awaited<ReturnType<typeof setup>>) =>
  (await j(await s.h.req(s.base, { token: s.token }))) as {
    pledges: { id: string }[];
    pendingPledges: { pid: string; kind: string; hash: string | null }[];
  };

Deno.test("admin pledges: a timed-out pledge that lands later is saved on the next read", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  const before = await page(s);
  assertEquals(before.pendingPledges.map((p) => [p.pid, p.kind]), [[fields.pid, "add"]]);
  assertEquals(before.pledges, []);
  s.land(hash);
  const after = await page(s);
  assertEquals(after.pendingPledges, []);
  assertEquals(after.pledges.map((p) => p.id), [fields.pid]);
  s.h.close();
});

Deno.test("admin pledges: a timed-out pledge that reverts later is dropped", async () => {
  const s = await setup();
  const { hash } = await timedOut(s);
  s.revert(hash);
  const after = await page(s);
  assertEquals(after.pendingPledges, []);
  assertEquals(after.pledges, []);
  s.h.close();
});

Deno.test("admin pledges: a retry waits for the change in flight and never sends a second one", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  // Still on its way: the retry is refused, nothing more is sent.
  const retry = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(retry.status, 409);
  const busy = await j(retry);
  assertEquals(busy.code, "pledge_pending");
  // Like the ballot's: the hash on its way, so the form waits for that one.
  assertEquals([busy.hash, busy.pid], [hash, fields.pid]);
  // The same from prepare: no new signature while one is on its way.
  const prep = await s.h.req(`${s.base}/pledges/prepare`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, pid: fields.pid },
  });
  assertEquals(prep.status, 409);
  assertEquals((await j(prep)).hash, hash);
  // It lands; the form's retry (same pid, a fresh signature) saves it, with no second pledge.
  s.land(hash);
  const { typed: _, ...again } = await prepare(s, { ...ACME, pid: fields.pid });
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...again },
  });
  assertEquals(res.status, 201, await res.clone().text());
  assertEquals(s.state.sent.length, 1);
  assertEquals((await s.h.db.pledges.list(s.r.id)).map((p) => p.id), [fields.pid]);
  s.h.close();
});

Deno.test("admin pledges: a signature from another wallet is refused", async () => {
  const s = await setup();
  const { typed: _, ...fields } = await prepare(s, ACME, OTHER);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 401);
  assertEquals((await j(res)).code, "bad_signature");
  assertEquals(s.state.sent, []);
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  s.h.close();
});

Deno.test("admin pledges: a signature over another amount than the one sent is refused", async () => {
  const s = await setup();
  const { typed: _, ...fields } = await prepare(s, { ...ACME, amount: "1" });
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 401);
  assertEquals(s.state.sent, []);
  s.h.close();
});

Deno.test("admin pledges: a deadline past the ten minutes is refused", async () => {
  const s = await setup();
  const { typed: _, ...fields } = await prepare(s, ACME);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields, deadline: String(NOW + 3600) },
  });
  assertEquals(res.status, 400);
  assertEquals(s.state.sent, []);
  s.h.close();
});

Deno.test("admin pledges: marking a pledge received sends amount 0", async () => {
  const s = await setup();
  const p = await s.h.db.pledges.add(s.r.id, {
    company: "Old",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const { typed, ...fields } = await prepare(s, { pid: p.id, status: "received" });
  assertEquals(typed.message.amount, 0n);
  assertEquals(typed.message.pledgeId, pledgeChainId(p.id));
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { status: "received", ...fields },
  });
  assertEquals(res.status, 202, await res.clone().text());
  assertEquals(s.state.sent.map((x) => x.amount), [0n]);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.status, "pledged");
  assertEquals((await settle(s, p.id, s.last())).state, "saved");
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.status, "received");
  s.h.close();
});

Deno.test("admin pledges: removing a pledge sends amount 0 and removes it", async () => {
  const s = await setup();
  const p = await s.h.db.pledges.add(s.r.id, {
    company: "Old",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const { typed, ...fields } = await prepare(s, { pid: p.id, remove: true });
  assertEquals(typed.message.amount, 0n);
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "DELETE",
    token: s.token,
    json: fields,
  });
  assertEquals(res.status, 202, await res.clone().text());
  assertEquals(s.state.sent.map((x) => [x.pledgeId, x.amount]), [[pledgeChainId(p.id), 0n]]);
  assertEquals(await settle(s, p.id, s.last()), { state: "saved", pledge: null });
  assertEquals(await s.h.db.pledges.get(s.r.id, p.id), null);
  s.h.close();
});

Deno.test("admin pledges: a node that loses the transaction or errors never drops a change that lands", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  // Two minutes on: the node no longer knows the transaction, then its lookups fail.
  s.h.clock.now = NOW + 120;
  s.state.statuses.delete(hash);
  assertEquals((await page(s)).pendingPledges.map((p) => p.pid), [fields.pid]);
  s.state.txStatusFails = true;
  assertEquals((await page(s)).pendingPledges.map((p) => p.pid), [fields.pid]);
  s.land(hash);
  const after = await page(s);
  assertEquals(after.pendingPledges, []);
  assertEquals(after.pledges.map((p) => p.id), [fields.pid]);
  s.h.close();
});

Deno.test("admin pledges: settle says failed once the change can no longer land", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  s.state.statuses.delete(hash);
  assertEquals((await settle(s, fields.pid, hash)).state, "pending");
  s.h.clock.now = NOW + 600 + 61;
  assertEquals((await settle(s, fields.pid, hash)).state, "failed");
  assertEquals((await page(s)).pendingPledges, []);
  s.h.close();
});

Deno.test("admin pledges: settle says failed once another signature used the nonce", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  s.state.statuses.delete(hash);
  s.state.nonces.set(ADMIN.toLowerCase(), 1n);
  assertEquals((await settle(s, fields.pid, hash)).state, "failed");
  s.h.close();
});

Deno.test("admin pledges: settle after the page load applied it says saved", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  s.land(hash);
  assertEquals((await page(s)).pledges.map((p) => p.id), [fields.pid]);
  const r = await settle(s, fields.pid, hash);
  assertEquals([r.state, r.pledge?.id], ["saved", fields.pid]);
  s.h.close();
});

Deno.test("admin pledges: settle with no record or outcome for the hash reports the transaction, with no row", async () => {
  const s = await setup();
  const p = await s.h.db.pledges.add(s.r.id, {
    company: "Old",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const tx = (n: string) => `0x${n.repeat(64)}` as Hex;
  s.state.statuses.set(tx("a"), "success");
  s.state.statuses.set(tx("b"), "reverted");
  assertEquals(await settle(s, p.id, tx("a")), { state: "saved", pledge: null });
  assertEquals(await settle(s, p.id, tx("b")), { state: "failed", pledge: null });
  assertEquals(await settle(s, p.id, tx("c")), { state: "pending", pledge: null });
  // No hash and nothing kept: not known, so never "failed" (nothing was saved) by guess.
  assertEquals(await settle(s, p.id, null), { state: "pending", pledge: null });
  s.h.close();
});

Deno.test("admin pledges: settle with a hash other than the record's leaves that record alone", async () => {
  const s = await setup();
  const { fields, hash } = await timedOut(s);
  s.land(hash);
  const other = `0x${"a".repeat(64)}` as Hex;
  s.state.statuses.set(other, "reverted");
  assertEquals(await settle(s, fields.pid, other), { state: "failed", pledge: null });
  // The record in flight is untouched (not settled by a look for another hash)...
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  // ...and its own hash settles it.
  assertEquals((await settle(s, fields.pid, hash)).state, "saved");
  s.h.close();
});

Deno.test("admin pledges: a send with no hash that can no longer land settles as failed from its kept outcome", async () => {
  const s = await setup();
  s.state.receipt = "pending";
  s.state.throwAfterSend = true;
  const { typed: _, ...fields } = await prepare(s, ACME);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 202);
  assertEquals((await settle(s, fields.pid, null)).state, "pending");
  s.h.clock.now = NOW + 600 + 61;
  assertEquals((await settle(s, fields.pid, null)).state, "failed");
  assertEquals((await settle(s, fields.pid, null)).state, "failed");
  s.h.close();
});

Deno.test("admin pledges: a change is dropped once it can no longer land", async () => {
  const s = await setup();
  const { hash } = await timedOut(s);
  s.state.statuses.delete(hash);
  // Its deadline (ten minutes) and the margin have passed, and the chain doesn't hold it.
  s.h.clock.now = NOW + 600 + 61;
  const after = await page(s);
  assertEquals(after.pendingPledges, []);
  assertEquals(after.pledges, []);
  s.h.close();
});

Deno.test("admin pledges: a change whose nonce another signature used is dropped", async () => {
  const s = await setup();
  const { hash } = await timedOut(s);
  s.state.statuses.delete(hash);
  s.state.nonces.set(ADMIN.toLowerCase(), 1n);
  const after = await page(s);
  assertEquals(after.pendingPledges, []);
  assertEquals(after.pledges, []);
  s.h.close();
});

Deno.test("admin pledges: a send that fails after its broadcast keeps the change, saved when it lands", async () => {
  const s = await setup();
  s.state.receipt = "pending";
  s.state.throwAfterSend = true;
  const { typed: _, ...fields } = await prepare(s, ACME);
  const res = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 202);
  assertEquals(await j(res), { hash: null, pid: fields.pid });
  // No hash was stored; well past two minutes on it is still kept.
  s.h.clock.now = NOW + 300;
  assertEquals((await page(s)).pendingPledges.map((p) => [p.pid, p.hash]), [[fields.pid, null]]);
  s.land(s.last());
  assertEquals((await page(s)).pledges.map((p) => p.id), [fields.pid]);
  s.h.close();
});

Deno.test("admin pledges: after the round closes a write settles the change left in flight first", async () => {
  const s = await setup();
  const p = await s.h.db.pledges.add(s.r.id, {
    company: "Old",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  s.state.receipt = "pending";
  const { typed: _, ...fields } = await prepare(s, { pid: p.id, amount: "700" });
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "700", ...fields },
  });
  assertEquals(res.status, 202);
  s.land(s.last());
  s.h.clock.now = s.m.closesAt;
  // Saved without a signature now, after the landed edit, which never comes back over it.
  const edit = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "900" },
  });
  assertEquals(edit.status, 200);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 900);
  const after = await page(s);
  assertEquals(after.pendingPledges, []);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 900);
  s.h.close();
});

Deno.test("admin pledges: a pledge id on its way for another initiative is refused", async () => {
  const s = await setup();
  const other = await s.h.db.initiatives.insert({
    title: "Other one",
    summary: "s",
    status: "approved",
    goalUsd: 10_000,
  });
  assertEquals(other.slug, "other-one");
  const theirs = { ...s, base: `/api/admin/initiatives/${other.id}` };
  s.state.receipt = "pending";
  const { typed: _, ...fields } = await prepare(theirs, ACME);
  const res = await s.h.req(`${theirs.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...fields },
  });
  assertEquals(res.status, 202);
  s.state.receipt = "success";
  const { typed: __, ...mine } = await prepare(s, { ...ACME, pid: fields.pid });
  const here = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token: s.token,
    json: { ...ACME, ...mine },
  });
  assertEquals(here.status, 409);
  assertEquals((await j(here)).code, "pledge_id_taken");
  assertEquals(s.state.sent.length, 1);
  s.h.close();
});

Deno.test("admin pledges: a request that dies while applying a landed change leaves it, applied once later", async () => {
  const s = await setup();
  const p = await s.h.db.pledges.add(s.r.id, {
    company: "Old",
    amountUsd: 100,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  s.state.receipt = "pending";
  const { typed: _, ...fields } = await prepare(s, { pid: p.id, amount: "700" });
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "700", ...fields },
  });
  assertEquals(res.status, 202);
  s.land(s.last());
  // The first apply dies after the claim (as an isolate would).
  const update = s.h.db.pledges.update;
  let applied = 0;
  let crash = true;
  s.h.db.pledges.update = (...args) => {
    if (crash) {
      crash = false;
      return Promise.reject(new Error("isolate died"));
    }
    applied++;
    return update(...args);
  };
  assertEquals((await page(s)).pendingPledges.map((x) => x.pid), [p.id]);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 100);
  // Its claim still holds: nobody else applies it meanwhile.
  assertEquals((await page(s)).pendingPledges.map((x) => x.pid), [p.id]);
  assertEquals(applied, 0);
  // Once the claim lapses, the next look applies it, once.
  s.h.clock.now += 61;
  assertEquals((await page(s)).pendingPledges, []);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 700);
  await page(s);
  assertEquals(applied, 1);
  s.h.close();
});

Deno.test("admin pledges: settling reads the nonce and the pledge at one block", async () => {
  const s = await setup();
  await timedOut(s);
  s.state.reads = [];
  await page(s);
  const nonce = s.state.reads.find(([k]) => k === "nonce")?.[1];
  const pledge = s.state.reads.find(([k]) => k === "pledge")?.[1];
  assertEquals(typeof nonce, "bigint");
  assertEquals(nonce, pledge);
  s.h.close();
});

// Awaiting signature: a site admin whose wallet lacks the round's PLEDGE_ROLE.

/** A second site admin, whose wallet holds no role on the round. */
async function otherAdmin(s: Awaited<ReturnType<typeof setup>>) {
  await s.h.deps.admins.add(OTHER.address);
  return await s.h.mint(OTHER.address, true);
}
type Awaiting = {
  pid: string;
  kind: string;
  company: string;
  amountUsd: number | null;
  fromUsd: number | null;
  status: string | null;
  by: string;
  at: number;
  lastError: string | null;
  lastErrorAt: number | null;
};
const awaiting = async (s: Awaited<ReturnType<typeof setup>>) =>
  ((await j(await s.h.req(s.base, { token: s.token }))) as { awaitingPledges: Awaiting[] })
    .awaitingPledges;
const OLD_ROW = {
  company: "Old",
  amountUsd: 100,
  status: "pledged" as const,
  note: "",
  url: "",
  logoCid: "",
};

Deno.test("admin pledges: a site admin without the pledge role saves a pledge as awaiting", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  assertEquals(res.status, 202, await res.clone().text());
  const body = await j(res);
  assertEquals(body.awaiting, true);
  assertEquals(typeof body.pid, "string");
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  assertEquals(s.state.sent, []);
  const pub = await j(await s.h.req(`/api/initiatives/${s.r.slug}`));
  assertEquals(pub.pledges, []);
  assertEquals(await awaiting(s), [{
    pid: body.pid as string,
    kind: "add",
    company: "Acme",
    amountUsd: 500,
    fromUsd: null,
    status: "pledged",
    by: OTHER.address,
    at: NOW,
    lastError: null,
    lastErrorAt: null,
  }]);
  s.h.close();
});

Deno.test("admin pledges: a second change to an awaiting pledge replaces it", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  const pid = (await j(res)).pid as string;
  const edit = await s.h.req(`${s.base}/pledges/${pid}`, {
    method: "PATCH",
    token,
    json: { amount: "700" },
  });
  assertEquals(edit.status, 202, await edit.clone().text());
  assertEquals(await j(edit), { awaiting: true, pid });
  const list = await awaiting(s);
  assertEquals(list.map((a) => [a.pid, a.kind, a.company, a.amountUsd]), [
    [pid, "add", "Acme", 700],
  ]);
  // Two edits to a saved pledge: one request, the later fields win.
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  for (const json of [{ amount: "200", note: "first" }, { amount: "300" }]) {
    const r = await s.h.req(`${s.base}/pledges/${p.id}`, { method: "PATCH", token, json });
    assertEquals(r.status, 202);
  }
  const edits = (await awaiting(s)).filter((a) => a.pid === p.id);
  assertEquals(edits.map((a) => [a.kind, a.amountUsd, a.fromUsd]), [["edit", 300, 100]]);
  // Removing the awaiting add drops it: nothing was on-chain or saved.
  const del = await s.h.req(`${s.base}/pledges/${pid}`, { method: "DELETE", token });
  assertEquals(del.status, 200, await del.clone().text());
  // Removing the edited one replaces its edit.
  const del2 = await s.h.req(`${s.base}/pledges/${p.id}`, { method: "DELETE", token });
  assertEquals(del2.status, 202);
  assertEquals((await awaiting(s)).map((a) => [a.pid, a.kind]), [[p.id, "remove"]]);
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 100);
  assertEquals(s.state.sent, []);
  s.h.close();
});

Deno.test("admin pledges: an awaiting change to an existing pledge leaves the row as it is", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { amount: "250", status: "received" },
  });
  assertEquals(res.status, 202, await res.clone().text());
  assertEquals(await j(res), { awaiting: true, pid: p.id });
  const row = await s.h.db.pledges.get(s.r.id, p.id);
  assertEquals([row?.amountUsd, row?.status], [100, "pledged"]);
  const [a] = await awaiting(s);
  // Received: it takes nothing off the ask, so 0 goes on-chain.
  assertEquals([a.pid, a.kind, a.company, a.amountUsd, a.fromUsd, a.status], [
    p.id,
    "edit",
    "Old",
    0,
    100,
    "received",
  ]);
  // A pledge that is neither saved nor awaiting is not found.
  const missing = await s.h.req(`${s.base}/pledges/nope`, {
    method: "PATCH",
    token,
    json: { amount: "1" },
  });
  assertEquals(missing.status, 404);
  s.h.close();
});

Deno.test("admin pledges: discarding an awaiting pledge removes the request", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  const pid = (await j(res)).pid as string;
  // Any site admin can discard it.
  const del = await s.h.req(`${s.base}/pledge-requests/${pid}`, {
    method: "DELETE",
    token: s.token,
  });
  assertEquals(del.status, 200, await del.clone().text());
  assertEquals(await awaiting(s), []);
  const again = await s.h.req(`${s.base}/pledge-requests/${pid}`, {
    method: "DELETE",
    token: s.token,
  });
  assertEquals(again.status, 404);
  s.h.close();
});

Deno.test("admin pledges: a landed signature clears the awaiting request", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { amount: "250" },
  });
  assertEquals(res.status, 202);
  assertEquals((await awaiting(s)).length, 1);
  // A round admin signs the same change.
  const { typed: _, ...fields } = await prepare(s, { pid: p.id, amount: "250" });
  const signed = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "250", ...fields },
  });
  assertEquals(signed.status, 202, await signed.clone().text());
  assertEquals((await settle(s, p.id, s.last())).state, "saved");
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 250);
  assertEquals(await awaiting(s), []);
  s.h.close();
});

Deno.test("admin pledges: a wallet with the pledge role is still asked to sign", async () => {
  const s = await setup();
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token: s.token, json: ACME });
  assertEquals(res.status, 428);
  assertEquals(await awaiting(s), []);
  s.h.close();
});

Deno.test("admin pledges: a failed role check saves nothing", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  s.state.hasRoleFails = true;
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  assertEquals(res.status, 503, await res.clone().text());
  assertEquals(
    (await j(res)).error,
    "Couldn't check your wallet's role on the vote contract; try again.",
  );
  s.state.hasRoleFails = false;
  assertEquals(await awaiting(s), []);
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  s.h.close();
});

Deno.test("admin pledges: the role check asks about the pledge role", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const asked: Hex[] = [];
  const chain = s.h.deps.vote!.chain;
  const orig = chain.hasRole;
  chain.hasRole = (role, a) => {
    asked.push(role);
    return orig(role, a);
  };
  await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  assertEquals(asked, [PLEDGE_ROLE_ID]);
  s.h.close();
});

Deno.test("admin pledges: an initiative outside the round never holds a pledge", async () => {
  const s = await setup("real", false);
  const token = await otherAdmin(s);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  assertEquals(res.status, 201);
  assertEquals((await s.h.db.pledges.list(s.r.id)).length, 1);
  assertEquals(await awaiting(s), []);
  s.h.close();
});

Deno.test("admin pledges: a test round never holds a pledge", async () => {
  const s = await setup("test");
  const token = await otherAdmin(s);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  assertEquals(res.status, 201);
  assertEquals(await awaiting(s), []);
  s.h.close();
});

Deno.test("admin pledges: a signature landing after a newer awaiting change leaves that change", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const ask = (amount: string) =>
    s.h.req(`${s.base}/pledges/${p.id}`, { method: "PATCH", token, json: { amount } });
  assertEquals((await ask("250")).status, 202);
  // A round admin signs the 250 change; before it is sent, the request moves to 300.
  const { typed: _, ...fields } = await prepare(s, { pid: p.id, amount: "250" });
  assertEquals((await ask("300")).status, 202);
  const signed = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "250", ...fields },
  });
  assertEquals(signed.status, 202, await signed.clone().text());
  assertEquals((await settle(s, p.id, s.last())).state, "saved");
  assertEquals((await s.h.db.pledges.get(s.r.id, p.id))?.amountUsd, 250);
  assertEquals((await awaiting(s)).map((a) => [a.pid, a.amountUsd, a.fromUsd]), [
    [p.id, 300, 250],
  ]);
  s.h.close();
});

Deno.test("admin pledges: an awaiting change racing another admin's merges both", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const d = s.h.deps.vote!;
  const requests = pledgeRequests(s.h.deps);
  // Another admin's note lands between this request's read and its write.
  const get = s.h.db.pledges.get;
  let raced = false;
  s.h.db.pledges.get = async (...args) => {
    if (!raced) {
      raced = true;
      await requests.put(d, {
        rfpId: s.r.id,
        pid: p.id,
        change: { kind: "edit", patch: { note: "theirs" } },
        by: ADMIN,
        at: NOW,
      });
    }
    return await get(...args);
  };
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { amount: "250" },
  });
  assertEquals(res.status, 202, await res.clone().text());
  assertEquals((await requests.get(d, s.r.id, p.id))?.change, {
    kind: "edit",
    patch: { note: "theirs", amountUsd: 250 },
  });
  s.h.close();
});

Deno.test("admin pledges: a signed change sent while an awaiting change is saved wins, with 409", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const d = s.h.deps.vote!;
  // A round admin's signed change is claimed between this request's read and its write.
  const get = s.h.db.pledges.get;
  let raced = false;
  s.h.db.pledges.get = async (...args) => {
    if (!raced) {
      raced = true;
      await s.h.kv.set([...roundKey(d.manifest), "pledge-pending", s.r.id, p.id], {
        rfpId: s.r.id,
        pid: p.id,
        initiativeId: 1,
        change: { kind: "edit", patch: { amountUsd: 400 } },
        amount: "400000000",
        admin: ADMIN,
        nonce: "0",
        deadline: String(NOW + 600),
        hash: null,
        at: NOW,
      });
    }
    return await get(...args);
  };
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { amount: "250" },
  });
  assertEquals(res.status, 409, await res.clone().text());
  assertEquals((await j(res)).code, "pledge_pending");
  assertEquals(await pledgeRequests(s.h.deps).get(d, s.r.id, p.id), null);
  s.h.close();
});

Deno.test("admin pledges: withdrawing an awaiting pledge discards it", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const res = await s.h.req(`${s.base}/pledges`, { method: "POST", token, json: ACME });
  const pid = (await j(res)).pid as string;
  const w = await s.h.req(`${s.base}/pledges/${pid}`, {
    method: "PATCH",
    token,
    json: { status: "withdrawn" },
  });
  assertEquals(w.status, 200, await w.clone().text());
  assertEquals(await awaiting(s), []);
  assertEquals(await s.h.db.pledges.list(s.r.id, true), []);
  s.h.close();
});

Deno.test("admin pledges: an awaiting status change shows the amount that goes on-chain", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, { ...OLD_ROW, amountUsd: 20_000 });
  const res = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { status: "withdrawn" },
  });
  assertEquals(res.status, 202, await res.clone().text());
  const add = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token,
    json: { company: "Paid", amount: "50000", status: "received" },
  });
  assertEquals(add.status, 202, await add.clone().text());
  const list = await awaiting(s);
  const edit = list.find((a) => a.pid === p.id)!;
  assertEquals([edit.amountUsd, edit.fromUsd, edit.status], [0, 20_000, "withdrawn"]);
  const paid = list.find((a) => a.kind === "add")!;
  assertEquals([paid.company, paid.amountUsd, paid.status], ["Paid", 0, "received"]);
  s.h.close();
});

Deno.test("admin pledges: after the vote closes an awaiting pledge is saved as it is", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const add = await s.h.req(`${s.base}/pledges`, {
    method: "POST",
    token,
    json: { company: "Late", amount: "50000" },
  });
  assertEquals(add.status, 202);
  const pid = (await j(add)).pid as string;
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const edit = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { amount: "300", status: "received" },
  });
  assertEquals(edit.status, 202);
  const save = (id: string) =>
    s.h.req(`${s.base}/pledge-requests/${id}/save`, { method: "POST", token, json: {} });
  // While the vote is open it can only be signed.
  assertEquals((await save(pid)).status, 409);
  assertEquals(await s.h.db.pledges.get(s.r.id, pid), null);
  const before = await j(await s.h.req(s.base, { token: s.token }));
  assertEquals(before.awaitingClosed, false);

  s.h.clock.now = s.m.closesAt;
  const page = await j(await s.h.req(s.base, { token: s.token }));
  assertEquals(page.awaitingClosed, true);
  assertEquals((page.awaitingPledges as unknown[]).length, 2);
  const res = await save(pid);
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(((await j(res)).pledge as { id: string }).id, pid);
  const saved = await s.h.db.pledges.get(s.r.id, pid);
  assertEquals([saved?.company, saved?.amountUsd, saved?.status], ["Late", 50_000, "pledged"]);
  assertEquals((await save(p.id)).status, 200);
  const row = await s.h.db.pledges.get(s.r.id, p.id);
  assertEquals([row?.amountUsd, row?.status], [300, "received"]);
  assertEquals(await awaiting(s), []);
  assertEquals((await save(pid)).status, 404);
  assertEquals(s.state.sent, []);
  s.h.close();
});

Deno.test("admin pledges: a landed signed remove drops the awaiting request for that pledge", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const held = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token,
    json: { amount: "250" },
  });
  assertEquals(held.status, 202);
  // A round admin removes the pledge from the form, signed.
  const { typed: _, ...fields } = await prepare(s, { pid: p.id, remove: true });
  const del = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "DELETE",
    token: s.token,
    json: fields,
  });
  assertEquals(del.status, 202, await del.clone().text());
  assertEquals((await settle(s, p.id, s.last())).state, "saved");
  assertEquals(await s.h.db.pledges.get(s.r.id, p.id), null);
  assertEquals(await awaiting(s), []);
  s.h.close();
});

Deno.test("admin pledges: a failed signed send keeps the request with the reason, a later change clears it", async () => {
  const s = await setup();
  const token = await otherAdmin(s);
  const p = await s.h.db.pledges.add(s.r.id, OLD_ROW);
  const hold = (amount: string) =>
    s.h.req(`${s.base}/pledges/${p.id}`, { method: "PATCH", token, json: { amount } });
  assertEquals((await hold("250")).status, 202);
  // Reverted on-chain.
  s.state.receipt = "reverted";
  const { typed: _, ...fields } = await prepare(s, { pid: p.id, amount: "250" });
  const sent = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "250", ...fields },
  });
  assertEquals(sent.status, 202, await sent.clone().text());
  assertEquals((await settle(s, p.id, s.last())).state, "failed");
  let [a] = await awaiting(s);
  assertEquals([a.amountUsd, a.lastError, a.lastErrorAt], [
    250,
    "the transaction failed on-chain",
    NOW,
  ]);
  // Refused before the broadcast: a stale nonce.
  s.state.receipt = "success";
  const again = await prepare(s, { pid: p.id, amount: "250" });
  s.state.nonces.set(ADMIN_KEY.address.toLowerCase(), 5n);
  const { typed: __, ...stale } = again;
  const refused = await s.h.req(`${s.base}/pledges/${p.id}`, {
    method: "PATCH",
    token: s.token,
    json: { amount: "250", ...stale },
  });
  assertEquals(refused.status, 502, await refused.clone().text());
  [a] = await awaiting(s);
  assertEquals(
    a.lastError,
    "the signature was already used, or another pledge of yours went first",
  );
  // A later change replaces the request, and the reason with it.
  assertEquals((await hold("260")).status, 202);
  [a] = await awaiting(s);
  assertEquals([a.amountUsd, a.lastError, a.lastErrorAt], [260, null, null]);
  s.h.close();
});
