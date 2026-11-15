/** Admin pledges during the real vote: signed by the admin, relayed with setPledgeBySig,
 * answered with the hash right after the broadcast, saved only once the chain holds it. */
import { assertEquals } from "@std/assert";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex, verifyTypedData } from "viem";
import { ADMIN, harness, j } from "./app-helpers.ts";
import type { VoteChain } from "../services/vote-chain.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { pledgeChainId, pledgeTypedData } from "../../shared/vote/typed-data.ts";
import { pledgeOnChain } from "../routes/admin.ts";

// ADMIN's key (app-helpers: wallet("0x11..11")).
const ADMIN_KEY = privateKeyToAccount(`0x${"11".repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${"33".repeat(32)}`);
const NOW = 1_800_000_000;
const RELAYER = "0x9000000000000000000000000000000000000009" as const;

const roundOf = (slugs: string[], kind: "real" | "test" = "real"): VoteManifest => ({
  kind,
  chainId: kind === "real" ? 1 : 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  ...(kind === "real" ? { badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C" as const } : {}),
  deployBlock: 1,
  opensAt: NOW - 3600,
  closesAt: NOW + 3600,
  schedule: {
    opensAt: NOW - 3600,
    firstTallyAt: [NOW + 600, NOW + 660, NOW + 720],
    initialWindow: 60,
    maxWindows: 1,
  },
  poolUsd: "913244000000",
  slugs,
  projects: slugs.map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
});

type PledgeCall = {
  pledgeId: Hex;
  initiativeId: bigint;
  currencyId: bigint;
  amount: bigint;
  signer: Hex;
  nonce: bigint;
  deadline: bigint;
};

/** A chain that does what setPledgeBySig does: consecutive nonces per signer, the
 * signature checked against the signer, the pledge set (re-homed if it existed). A
 * transaction lands at once unless `receipt` says otherwise; `land` and `revert` settle
 * one later. */
function fakeChain(m: VoteManifest) {
  const state = {
    nonces: new Map<string, bigint>(),
    sent: [] as PledgeCall[],
    /** What happens to the next transactions. */
    receipt: "success" as "success" | "reverted" | "pending",
    statuses: new Map<Hex, "success" | "reverted" | "pending">(),
    /** The contract's `pledges(bytes32)`. */
    pledges: new Map<Hex, { initiativeId: bigint; currencyId: bigint; amount: bigint }>(),
    byHash: new Map<Hex, PledgeCall>(),
    /** The node's receipt lookups fail (an RPC error). */
    txStatusFails: false,
    /** The send goes out, then the call throws (a failed write after the broadcast). */
    throwAfterSend: false,
    /** The block each nonce and pledge read named (undefined: the head). */
    reads: [] as [string, bigint | undefined][],
  };
  const land = (hash: Hex) => {
    const call = state.byHash.get(hash)!;
    const next = state.nonces.get(call.signer.toLowerCase()) ?? 0n;
    if (call.nonce !== next) {
      state.statuses.set(hash, "reverted");
      return;
    }
    state.nonces.set(call.signer.toLowerCase(), next + 1n);
    state.pledges.set(call.pledgeId, {
      initiativeId: call.initiativeId,
      currencyId: call.currencyId,
      amount: call.amount,
    });
    state.statuses.set(hash, "success");
  };
  const revert = (hash: Hex) => state.statuses.set(hash, "reverted");
  const unused = () => Promise.reject(new Error("not used here"));
  const chain = {
    relayerAddress: () => RELAYER,
    relayerNonce: () => Promise.resolve(state.sent.length),
    txStatus: (hash: Hex) =>
      state.txStatusFails
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(state.statuses.get(hash) ?? "unknown"),
    codeOf: () => Promise.resolve("0x"),
    blockNumber: () => Promise.resolve(BigInt(state.sent.length + 1)),
    pledgeNonceOf: (a: Hex, block?: bigint) => {
      state.reads.push(["nonce", block]);
      return Promise.resolve(state.nonces.get(a.toLowerCase()) ?? 0n);
    },
    pledgeOf: (id: Hex, block?: bigint) => {
      state.reads.push(["pledge", block]);
      const p = state.pledges.get(id);
      return Promise.resolve(
        p
          ? { ...p, exists: true }
          : { initiativeId: 0n, currencyId: 0n, amount: 0n, exists: false },
      );
    },
    async send(call: Parameters<VoteChain["send"]>[0]) {
      if (call.fn !== "setPledgeBySig") throw new Error(`unexpected ${call.fn}`);
      const [pledgeId, initiativeId, currencyId, amount, signer, nonce, deadline, signature] =
        call.args;
      // The node's gas estimate runs the call: a revert now is a failed send.
      const next = state.nonces.get(signer.toLowerCase()) ?? 0n;
      if (nonce !== next) throw new Error(`InvalidPledgeNonce(${signer}, ${nonce})`);
      if (BigInt(NOW) > deadline) throw new Error("PledgeExpired()");
      const ok = await verifyTypedData({
        address: signer,
        ...pledgeTypedData(m, { pledgeId, initiativeId, currencyId, amount, nonce, deadline }),
        signature,
      });
      if (!ok) throw new Error("InvalidSignature()");
      const hash = `0x${(state.sent.length + 1).toString(16).padStart(64, "0")}` as Hex;
      const sent = { pledgeId, initiativeId, currencyId, amount, signer, nonce, deadline };
      state.sent.push(sent);
      state.byHash.set(hash, sent);
      state.statuses.set(hash, "pending");
      if (state.receipt === "success") land(hash);
      if (state.receipt === "reverted") revert(hash);
      if (state.throwAfterSend) throw new Error("kv write failed");
      return hash;
    },
    ownerOf: unused,
    balanceOf: unused,
    badgeOf: unused,
    idsOf: unused,
    canMint: unused,
    nonceOf: unused,
    balance: unused,
    estimateRecordFor: unused,
    ballots: unused,
    committed: unused,
    rulesHistory: unused,
    asks: unused,
  } as unknown as VoteChain;
  /** The latest transaction sent. */
  const last = () => [...state.byHash.keys()].at(-1)!;
  return { state, chain, land, revert, last };
}

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

type Typed = ReturnType<typeof pledgeTypedData>;
/** The prepare answer's typed data, back to bigints, signed by `who`. */
async function signPrepared(
  body: Record<string, unknown>,
  who = ADMIN_KEY,
): Promise<{ pid: string; nonce: string; deadline: string; signature: Hex; typed: Typed }> {
  const typed = body.typedData as {
    domain: Typed["domain"];
    message: Record<string, string>;
  };
  const message = {
    pledgeId: typed.message.pledgeId as Hex,
    initiativeId: BigInt(typed.message.initiativeId),
    currencyId: BigInt(typed.message.currencyId),
    amount: BigInt(typed.message.amount),
    nonce: BigInt(typed.message.nonce),
    deadline: BigInt(typed.message.deadline),
  };
  const full = { ...(body.typedData as Typed), message };
  const signature = await who.signTypedData(full);
  return {
    pid: body.pid as string,
    nonce: typed.message.nonce,
    deadline: typed.message.deadline,
    signature,
    typed: full,
  };
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
