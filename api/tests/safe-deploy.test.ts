/**
 * Deploy first, approve second. The Safe lives at the CREATE2 address of the
 * canonical factory for (operational signers, initiative salt): the deploy
 * panel sends the admin's wallet there, safe-confirm binds the address once
 * code is at it and the Safe verifies, and approval is refused until then.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { SIGNERS } from "./helpers.ts";
import { predictSafeAddress } from "../chain/safe.ts";
import { syncAll } from "../services/safe-api.ts";
import type { Rfp } from "../db/types.ts";

type H = Awaited<ReturnType<typeof harness>>;

const predicted = (r: Rfp) => predictSafeAddress(SIGNERS, r.safeDeploymentKey ?? r.slug);
const url = (id: string) => `/api/admin/initiatives/${id}`;
const setStatus = (h: H, admin: string, id: string, action: string) =>
  h.req(url(id) + "/status", { method: "POST", token: admin, json: { action } });
const confirm = (h: H, admin: string, id: string) =>
  h.req(url(id) + "/safe-confirm", { method: "POST", token: admin, json: {} });
const safeCalls = (h: H) => h.fetchLog.filter((f) => f.url.startsWith("https://api.safe.global/"));

Deno.test("approval needs a deployed Safe: the panel targets the predicted address, safe-confirm binds it once it exists", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await h.db.rfps.insert({ title: "Deploy first", status: "pending", goalUsd: 1000 });
  const refused = await setStatus(h, admin, rfp.id, "approve");
  assertEquals(refused.status, 400);
  assertStringIncludes((await j(refused) as { error: string }).error, "Deploy");
  assertEquals((await h.db.rfps.get(rfp.id))!.status, "pending");
  // the panel: where the deploy lands, nothing written yet
  const params = await j(await h.req(url(rfp.id) + "/safe-deploy-params", { token: admin })) as {
    enabled: boolean;
    calldata: string;
    address: string;
    deployed: boolean;
  };
  assert(params.enabled);
  assert(params.calldata.startsWith("0x1688f0b9"));
  assertEquals(params.address, predicted(rfp));
  assertEquals(params.deployed, false);
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, "");
  // nothing on-chain yet (the tx is on its way, under whatever hash the wallet mined it as)
  assertEquals((await j(await confirm(h, admin, rfp.id)) as { status: string }).status, "pending");
  // the Safe lands
  h.script.code[predicted(rfp).toLowerCase()] = "0x6080";
  const conf = await j(await confirm(h, admin, rfp.id)) as {
    status: string;
    address: string;
    detail: string;
  };
  assertEquals(conf.status, "ok");
  assertEquals(conf.address, predicted(rfp));
  assertStringIncludes(conf.detail, "verified");
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, predicted(rfp));
  const again = await j(await h.req(url(rfp.id) + "/safe-deploy-params", { token: admin })) as {
    deployed: boolean;
  };
  assertEquals(again.deployed, true);
  // now approval lands, and donations open
  const ok = await j(await setStatus(h, admin, rfp.id, "approve")) as {
    initiative: { status: string; safeAddress: string };
  };
  assertEquals(ok.initiative.status, "approved");
  assertEquals(ok.initiative.safeAddress, predicted(rfp));
  const page = await j(await h.req(`/api/initiatives/${rfp.slug}`)) as {
    donationsEnabled: boolean;
  };
  assertEquals(page.donationsEnabled, true);
  // re-approving an archived initiative without a Safe is refused the same way
  const old = await h.db.rfps.insert({ title: "Archived one", status: "archived" });
  assertEquals((await setStatus(h, admin, old.id, "unarchive")).status, 400);
  h.close();
});

Deno.test("a contract at the predicted address that is not our Safe is rejected, never bound", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await h.db.rfps.insert({ title: "Tampered", status: "pending" });
  h.script.code[predicted(rfp).toLowerCase()] = "0x6080";
  h.script.brokenSafe = true; // getThreshold answers wrong
  const res = await confirm(h, admin, rfp.id);
  assertEquals(res.status, 400);
  assertStringIncludes((await j(res) as { detail: string }).detail, "REJECTED");
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, "");
  assertEquals((await setStatus(h, admin, rfp.id, "approve")).status, 400);
  h.close();
});

Deno.test("the predicted address held by another initiative is a 409 until the admin detaches it", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await h.db.rfps.insert({ title: "Mixed up", status: "pending" });
  const holder = await h.db.rfps.insert({
    title: "Holder of the wrong Safe",
    status: "approved",
    safeAddress: predicted(rfp),
  });
  h.script.code[predicted(rfp).toLowerCase()] = "0x6080";
  const dup = await confirm(h, admin, rfp.id);
  assertEquals(dup.status, 409);
  assertStringIncludes((await j(dup) as { detail: string }).detail, holder.slug);
  // the admin can detach (blank), never bind by hand
  assertEquals(
    (await h.req(url(holder.id), {
      method: "PATCH",
      token: admin,
      json: { safeAddress: SAFE_ADDR },
    }))
      .status,
    400,
  );
  assertEquals(
    (await h.req(url(holder.id), { method: "PATCH", token: admin, json: { safeAddress: "" } }))
      .status,
    200,
  );
  assertEquals((await h.db.rfps.get(holder.id))!.safeAddress, "");
  assertEquals((await j(await confirm(h, admin, rfp.id)) as { status: string }).status, "ok");
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, predicted(rfp));
  h.close();
});

Deno.test("the cron only syncs initiatives with a Safe; it never assigns one", async () => {
  const h = await harness();
  const bare = await h.db.rfps.insert({ title: "Approved without a Safe", status: "approved" });
  await h.db.rfps.insert({ title: "With a Safe", status: "approved", safeAddress: SAFE_ADDR });
  assertEquals(await syncAll(h.deps), 1);
  assertEquals((await h.db.rfps.get(bare.id))!.safeAddress, "");
  assertEquals(safeCalls(h).length, 1);
  assertStringIncludes(safeCalls(h)[0].url, SAFE_ADDR);
  h.close();
});

Deno.test("bulk approve: rows without a Safe fail one by one, the rest land", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const ready = await h.db.rfps.insert({
    title: "Ready",
    status: "pending",
    safeAddress: SAFE_ADDR,
  });
  const bare = await h.db.rfps.insert({ title: "Bare", status: "pending" });
  const res = await j(
    await h.req("/api/admin/initiatives/bulk", {
      method: "POST",
      token: admin,
      json: { action: "approve", ids: [ready.id, bare.id] },
    }),
  ) as { done: number; failed: { id: string; error: string }[] };
  assertEquals(res.done, 1);
  assertEquals(res.failed.map((f) => f.id), [bare.id]);
  assertStringIncludes(res.failed[0].error, "Deploy");
  assertEquals((await h.db.rfps.get(ready.id))!.status, "approved");
  assertEquals((await h.db.rfps.get(bare.id))!.status, "pending");
  h.close();
});

Deno.test("a Safe already on-chain but not yet bound: the panel reports it deployed, so no second (reverting) factory tx", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const rfp = await h.db.rfps.insert({ title: "Mined, unbound", status: "pending", goalUsd: 1000 });
  // the wallet mined the deploy under a hash the browser lost track of; safe-confirm never ran
  h.script.code[predicted(rfp).toLowerCase()] = "0x6080";
  assertEquals((await h.db.rfps.get(rfp.id))!.safeAddress, "");
  const params = await j(await h.req(url(rfp.id) + "/safe-deploy-params", { token: admin })) as {
    address: string;
    deployed: boolean;
  };
  assertEquals(params.address, predicted(rfp));
  assertEquals(params.deployed, true);
});
