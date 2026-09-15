/**
 * The donation Safe is counterfactual: its CREATE2 address is a pure function
 * of the operational signers and the initiative's salt, so it is assigned at
 * approval and donations open right away. Deploying only activates it; the
 * first payout is what needs it on-chain.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { SIGNERS } from "./helpers.ts";
import { predictSafeAddress, safeDeployCalldata } from "../chain/safe.ts";
import { syncAll } from "../services/safe-api.ts";
import type { Rfp } from "../db/types.ts";

type H = Awaited<ReturnType<typeof harness>>;

const keyOf = (r: Rfp) => r.safeDeploymentKey ?? r.slug;
const predicted = (r: Rfp) => predictSafeAddress(SIGNERS, keyOf(r));

async function submitted(h: H, title: string) {
  return await h.db.rfps.insert({ title, status: "pending", goalUsd: 1000 });
}

async function approve(h: H, admin: string, id: string) {
  const res = await h.req(`/api/admin/initiatives/${id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  assertEquals(res.status, 200);
  return (await j(res) as { initiative: { safeAddress: string; safeDeployed: boolean } })
    .initiative;
}

const safeCalls = (h: H) => h.fetchLog.filter((f) => f.url.startsWith("https://api.safe.global/"));

Deno.test("approving assigns the predicted Safe address before any deploy; donations open on it", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await submitted(h, "Counterfactual initiative");
  const out = await approve(h, admin, rfp.id);
  assertEquals(out.safeAddress, predicted(rfp));
  assertEquals(out.safeDeployed, false);
  const row = (await h.db.rfps.get(rfp.id))!;
  assertEquals(row.safeAddress, predicted(rfp));
  assertEquals(row.safeSigners, SIGNERS);
  assertFalse(row.safeDeployedAt);
  const page = await j(await h.req(`/api/initiatives/${row.slug}`)) as {
    donationsEnabled: boolean;
    initiative: { safeAddress: string; safeDeployed: boolean };
  };
  assertEquals(page.donationsEnabled, true);
  assertEquals(page.initiative.safeAddress, predicted(rfp));
  assertEquals(page.initiative.safeDeployed, false);
  h.close();
});

Deno.test("no address is assigned when the factory simulation disagrees with the prediction", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  h.script.factorySim = "0x" + "bb".repeat(20);
  const rfp = await submitted(h, "Mismatch initiative");
  const out = await approve(h, admin, rfp.id); // approval itself still lands
  assertEquals(out.safeAddress, "");
  const params = await h.req(`/api/admin/initiatives/${rfp.id}/safe-deploy-params`, {
    token: admin,
  });
  assertEquals(params.status, 503);
  assertStringIncludes((await j(params) as { reason: string }).reason, "predict");
  // an rpc that reverts the simulation is treated the same way
  h.script.factorySim = "revert";
  assertEquals(
    (await h.req(`/api/admin/initiatives/${rfp.id}/safe-deploy-params`, { token: admin })).status,
    503,
  );
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, "");
  h.close();
});

Deno.test("a predicted address held by another initiative is left to the admin: detach, then it assigns", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await submitted(h, "Mixed up initiative");
  const holder = await h.db.rfps.insert({
    title: "Holder of the wrong Safe",
    status: "approved",
    safeAddress: predicted(rfp),
  });
  assertEquals((await approve(h, admin, rfp.id)).safeAddress, "");
  const url = `/api/admin/initiatives/${holder.id}`;
  // admin can detach (blank), never bind by hand
  assertEquals(
    (await h.req(url, { method: "PATCH", token: admin, json: { safeAddress: predicted(rfp) } }))
      .status,
    400,
  );
  assertEquals(
    (await h.req(url, { method: "PATCH", token: admin, json: { safeAddress: "" } })).status,
    200,
  );
  assertEquals((await h.db.rfps.get(holder.id))!.safeAddress, "");
  // opening the deploy panel assigns the freed address
  const params = await j(
    await h.req(`/api/admin/initiatives/${rfp.id}/safe-deploy-params`, { token: admin }),
  ) as { address: string; deployed: boolean };
  assertEquals(params.address, predicted(rfp));
  assertEquals(params.deployed, false);
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, predicted(rfp));
  h.close();
});

Deno.test("deploy calldata comes from the signer snapshot frozen at assignment, not the live config", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await submitted(h, "Snapshot initiative");
  await approve(h, admin, rfp.id);
  const rotated = [...SIGNERS];
  rotated[4] = "0x000000000000000000000000000000000000dEaD";
  h.deps.config.operationalSigners = rotated;
  const params = await j(
    await h.req(`/api/admin/initiatives/${rfp.id}/safe-deploy-params`, { token: admin }),
  ) as { calldata: string; address: string; signers: string[] };
  assertEquals(params.address, predicted(rfp));
  assertEquals(params.signers, SIGNERS);
  assertEquals(params.calldata, safeDeployCalldata(SIGNERS, keyOf(rfp)));
  h.close();
});

Deno.test("safe-confirm: pending until code is at the assigned address, then deployed; the ledger sync waits for it", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await submitted(h, "Deploying initiative");
  await approve(h, admin, rfp.id);
  const base = `/api/admin/initiatives/${rfp.id}`;
  const ghostTx = "0x" + "ab".repeat(32); // a Safe-wallet hash that never gets a receipt
  const poll = () =>
    h.req(base + "/safe-confirm", { method: "POST", token: admin, json: { txHash: ghostTx } });
  assertEquals((await j(await poll()) as { status: string }).status, "pending");
  assertEquals(
    (await h.req(base + "/sync-donations", { method: "POST", token: admin })).status,
    400,
  );
  assertEquals(await syncAll(h.deps), 0);
  assertEquals(safeCalls(h).length, 0);
  // the Safe lands
  h.script.code[predicted(rfp).toLowerCase()] = "0x6080";
  const conf = await j(await poll()) as { status: string; address: string; detail: string };
  assertEquals(conf.status, "ok");
  assertEquals(conf.address, predicted(rfp));
  assertStringIncludes(conf.detail, "verified");
  assert((await h.db.rfps.get(rfp.id))!.safeDeployedAt);
  const page = await j(await h.req(`/api/initiatives/${rfp.slug}`)) as {
    initiative: { safeDeployed: boolean };
  };
  assertEquals(page.initiative.safeDeployed, true);
  assertEquals(await syncAll(h.deps), 1);
  assertEquals(safeCalls(h).length, 1);
  assertStringIncludes(safeCalls(h)[0].url, predicted(rfp));
  h.close();
});

Deno.test("safe-confirm: a reverted or mined-elsewhere deploy tx is an error, not pending forever", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await submitted(h, "Failed deploy initiative");
  await approve(h, admin, rfp.id);
  const confirm = async (tx: string) => {
    const res = await h.req(`/api/admin/initiatives/${rfp.id}/safe-confirm`, {
      method: "POST",
      token: admin,
      json: { txHash: tx },
    });
    return [res.status, await j(res) as { status: string; detail: string }] as const;
  };
  const reverted = "0x" + "c1".repeat(32);
  h.script.receipts[reverted] = { status: "0x0", logs: [] };
  const [s1, r1] = await confirm(reverted);
  assertEquals([s1, r1.status], [400, "error"]);
  assertStringIncludes(r1.detail, "reverted");
  const elsewhere = "0x" + "c2".repeat(32);
  h.script.receipts[elsewhere] = { status: "0x1", logs: [] };
  const [s2, r2] = await confirm(elsewhere);
  assertEquals([s2, r2.status], [400, "error"]);
  assertStringIncludes(r2.detail, predicted(rfp));
  assertFalse((await h.db.rfps.get(rfp.id))!.safeDeployedAt);
  h.close();
});

Deno.test("the cron backfills approved initiatives without an address and activates deployed ones", async () => {
  const h = await harness();
  // rows that predate this: approved, no address (as on prod today)
  const a = await h.db.rfps.insert({ title: "Legacy A", status: "approved" });
  const b = await h.db.rfps.insert({ title: "Legacy B", status: "approved" });
  const archived = await h.db.rfps.insert({ title: "Old one", status: "archived" });
  h.script.code[predicted(b).toLowerCase()] = "0x6080"; // deployed by hand already
  assertEquals(await syncAll(h.deps), 1); // only B has a Safe to sync
  const rowA = (await h.db.rfps.get(a.id))!;
  const rowB = (await h.db.rfps.get(b.id))!;
  assertEquals(rowA.safeAddress, predicted(a));
  assertFalse(rowA.safeDeployedAt);
  assertEquals(rowB.safeAddress, predicted(b));
  assert(rowB.safeDeployedAt);
  assertEquals(rowB.safeSigners, SIGNERS);
  assertEquals((await h.db.rfps.get(archived.id))!.safeAddress, "");
  assertEquals(safeCalls(h).length, 1);
  assertStringIncludes(safeCalls(h)[0].url, predicted(b));
  // a deploy the cron notices later flips A too
  h.script.code[predicted(a).toLowerCase()] = "0x6080";
  assertEquals(await syncAll(h.deps), 2);
  assert((await h.db.rfps.get(a.id))!.safeDeployedAt);
  h.close();
});

Deno.test("a Safe at the predicted address that fails verification is never assigned", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await submitted(h, "Tampered initiative");
  h.script.code[predicted(rfp).toLowerCase()] = "0x6080";
  h.script.brokenSafe = true; // getThreshold answers wrong
  assertEquals((await approve(h, admin, rfp.id)).safeAddress, "");
  const params = await h.req(`/api/admin/initiatives/${rfp.id}/safe-deploy-params`, {
    token: admin,
  });
  assertEquals(params.status, 503);
  assertStringIncludes((await j(params) as { reason: string }).reason, "REJECTED");
  h.close();
});
