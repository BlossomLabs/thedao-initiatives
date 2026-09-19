import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  ADMIN,
  type Harness,
  harness as appHarness,
  type HarnessOptions,
  j,
  ORIGIN,
  PLAIN,
  proposerToken,
  SAFE_ADDR,
} from "./app-helpers.ts";
import { transferLog, wallet } from "./helpers.ts";
import { K } from "../db/keys.ts";
import { SESSION_REAUTH_SECS, TOKENS } from "../config.ts";
import type { AuditEvent } from "../services/audit.ts";
import { createMaintenance, MAINTENANCE_CACHE_SECS } from "../services/maintenance.ts";
import { refreshDailyCache } from "../services/daily-cache.ts";

const w = wallet("0x" + "11".repeat(32));
const DONOR = "0x" + "44".repeat(20);
const TX1 = "0x" + "e1".repeat(32);
const USDC = TOKENS.USDC[0];

const transfers = () =>
  Response.json({
    count: 1,
    next: null,
    results: [{
      type: "ERC20_TRANSFER",
      executionDate: "2026-09-01T00:00:00Z",
      blockNumber: 500,
      transactionHash: TX1,
      to: SAFE_ADDR,
      from: DONOR,
      value: "1000000",
      tokenAddress: USDC,
      transferId: TX1,
    }],
  });

async function harness(opts?: HarnessOptions) {
  const h = await appHarness(opts);
  const logs: string[] = [];
  h.deps.log = (line) => logs.push(line);
  return { ...h, logs };
}
type MaintHarness = Awaited<ReturnType<typeof harness>>;
const events = (h: MaintHarness): AuditEvent[] =>
  h.logs.filter((line) => line.startsWith('{"securityAudit":true,')).map((line) =>
    JSON.parse(line)
  );
const forRequest = (h: MaintHarness, r: Response) =>
  events(h).filter((e) => e.requestId === r.headers.get("X-Request-ID"));

async function signed(h: Harness) {
  const nonce = await h.db.sessions.issueNonce();
  const message =
    `localhost:5173 wants you to sign in with your Ethereum account:\n${w.address}\n\n` +
    `Sign in\n\nURI: ${ORIGIN}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\n` +
    `Issued At: ${new Date(h.clock.now * 1000).toISOString()}`;
  return { message, signature: await w.sign(message) };
}

const OFF = { on: false, by: "", at: 0, note: "" };

Deno.test("maintenance: admins toggle it with recent authentication; the change is audited", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const plain = await h.mint(PLAIN);
    assertEquals(await j(await h.req("/api/admin/maintenance", { token: admin })), OFF);
    assertEquals((await h.req("/api/admin/maintenance", { token: plain })).status, 403);

    const stale = await h.mint(ADMIN, true);
    h.clock.now += SESSION_REAUTH_SECS;
    for (const path of ["/api/admin/maintenance/enter", "/api/admin/maintenance/exit"]) {
      const res = await h.req(path, { method: "POST", token: stale, json: {} });
      assertEquals(res.status, 403, path);
      assertEquals((await j(res)).reauthenticate, true);
    }
    assertEquals(await h.deps.maintenance.fresh(), OFF);

    const fresh = await h.mint(ADMIN, true);
    const enter = await h.req("/api/admin/maintenance/enter", {
      method: "POST",
      token: fresh,
      json: { note: "Moving the database" },
    });
    assertEquals(res200(enter), true);
    assertEquals(await j(enter), {
      on: true,
      by: ADMIN,
      at: h.clock.now,
      note: "Moving the database",
    });
    const entered = forRequest(h, enter).filter((e) => e.action === "maintenance.enter");
    assertEquals(entered.map((e) => e.outcome), ["attempt", "success"]);
    assertEquals(entered[1].actor, ADMIN.toLowerCase());

    const exit = await h.req("/api/admin/maintenance/exit", {
      method: "POST",
      token: fresh,
      json: {},
    });
    assertEquals(await j(exit), { on: false, by: ADMIN, at: h.clock.now, note: "" });
    assertEquals(
      forRequest(h, exit).filter((e) => e.action === "maintenance.exit").map((e) => e.outcome),
      ["attempt", "success"],
    );
  } finally {
    h.close();
  }
});

const res200 = (r: Response) => r.status === 200;

Deno.test("maintenance: every write answers 503, sign-in and the admin controls keep working, reads are untouched", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const proposer = await proposerToken(h);
    const initiative = await h.db.initiatives.insert({
      title: "Frozen",
      status: "approved",
      goalUsd: 10,
    });
    assertEquals(
      (await h.req("/api/admin/maintenance/enter", { method: "POST", token: admin, json: {} }))
        .status,
      200,
    );

    const blocked: [string, string, string | undefined, unknown][] = [
      ["POST", "/api/initiatives", proposer, { title: "x" }],
      ["POST", `/api/initiatives/${initiative.slug}/comments`, undefined, { body: "hi" }],
      ["POST", `/api/admin/initiatives/${initiative.id}/status`, admin, { action: "archive" }],
      ["PATCH", `/api/admin/initiatives/${initiative.id}`, admin, { sortRank: "1" }],
      ["POST", "/api/nickname", proposer, { nickname: "frozen" }],
      ["POST", "/api/donate/confirm", undefined, {}],
      ["POST", "/api/support", undefined, { message: "hi" }],
      ["POST", "/api/admin/admins", admin, { address: PLAIN }],
    ];
    for (const [method, path, token, json] of blocked) {
      const res = await h.req(path, { method, token, json });
      assertEquals(res.status, 503, `${method} ${path}`);
      const body = await j(res);
      assertEquals(body.maintenance, true, path);
      assert(String(body.error).includes("maintenance"), path);
      assertFalse(
        forRequest(h, res).some((e) => e.action === "request.failed"),
        `${path} audited as a failure`,
      );
    }
    assertEquals(await h.db.initiatives.get(initiative.id), initiative);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), false);
    assertEquals((await h.db.comments.forInitiative(initiative.id)).length, 0);

    // Sign-in, sign-out and session management stay open.
    const login = await h.req("/api/auth/verify", { method: "POST", json: await signed(h) });
    assertEquals(login.status, 200, "verify");
    const bearer = (await j(login)).token as string;
    assertEquals(
      (await h.req("/api/auth/sessions", { token: bearer })).status,
      200,
    );
    assertEquals(
      (await h.req("/api/auth/logout", { method: "POST", token: bearer, json: {} })).status,
      200,
      "logout",
    );
    // Reads done as POST, the CSP endpoint and a CORS preflight stay open.
    assertEquals(
      (await h.req("/api/comments/mine", { method: "POST", json: { tokens: [] } })).status,
      200,
      "comments/mine",
    );
    const search = await h.req("/api/ai-search", { method: "POST", json: { query: "audit" } });
    assertEquals((await j(search)).maintenance, undefined, "ai-search is not gated");
    assertEquals(
      (await h.req("/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: JSON.stringify({ "csp-report": { "violated-directive": "script-src" } }),
      })).status,
      204,
      "csp-report",
    );
    const preflight = await h.req("/api/initiatives", {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
    });
    assert(preflight.status < 300, `preflight ${preflight.status}`);

    // Public reads are unchanged and the settings carry the flag for the banner.
    assertEquals((await h.req("/api/board")).status, 200);
    assertEquals((await h.req(`/api/initiatives/${initiative.slug}`)).status, 200);
    const settings = await j(await h.req("/api/board/settings"));
    assertEquals(settings.maintenance, { on: true, at: h.clock.now, note: "" });

    assertEquals(
      (await h.req("/api/admin/maintenance/exit", { method: "POST", token: admin, json: {} }))
        .status,
      200,
    );
    const thawed = await h.req("/api/nickname", {
      method: "POST",
      token: proposer,
      json: { nickname: "thawed" },
    });
    assert(thawed.status !== 503, `writes resume after exit (${thawed.status})`);
    assertEquals((await j(await h.req("/api/board/settings"))).maintenance, {
      on: false,
      at: h.clock.now,
      note: "",
    });
  } finally {
    h.close();
  }
});

Deno.test("maintenance: background refreshes reachable from reads and the cron stay quiet", async () => {
  const h = await harness({ fetch: () => transfers() });
  try {
    const admin = await h.mint(ADMIN, true);
    const initiative = await h.db.initiatives.insert({
      title: "Quiet",
      status: "approved",
      goalUsd: 10,
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = {
      status: "0x1",
      blockNumber: "0x1f4",
      logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
    };
    h.script.tokenBalances[`USDC:${SAFE_ADDR.toLowerCase()}`] = 2_000_000n;
    await h.deps.chain.state(); // token verification is not a write; warm it up
    await h.req("/api/admin/maintenance/enter", { method: "POST", token: admin, json: {} });
    h.script.calls.length = 0;

    for (const path of ["/api/board?refresh=1", `/api/initiatives/${initiative.slug}?refresh=1`]) {
      const res = await j(await h.req(path));
      assertEquals(res.refreshDue, false, path);
      const summary = (path.startsWith("/api/board")
        ? (res.cards as { summary: unknown; ledger: unknown }[])[0]
        : res) as { summary: { refreshDue: boolean }; ledger: { refreshDue: boolean } };
      assertEquals(summary.summary.refreshDue, false, path);
      assertEquals(summary.ledger.refreshDue, false, path);
    }
    assertEquals(h.fetchLog, [], "no Safe API sync while on");
    assertEquals(h.script.calls, [], "no balance RPC while on");
    assertEquals(await h.db.meta.safeSync(initiative.id), null);
    assertEquals(await h.deps.funding.balances(SAFE_ADDR), null);

    // A pending donation is not re-verified from its status read.
    await h.kv.set(K.donation(initiative.id, TX1), {
      rfpId: initiative.id,
      txHash: TX1,
      tokenSymbol: "USDC",
      tokenAddress: USDC,
      amountRaw: "0",
      amountUsd: 0,
      donor: DONOR,
      status: "pending",
      detail: "",
      source: "tx",
      createdAt: h.clock.now,
      confirmedAt: null,
    });
    await h.kv.set(K.donationByTx(TX1, initiative.id), true);
    assertEquals((await j(await h.req(`/api/donate/status/${TX1}`))).status, "pending");
    assertEquals(h.script.calls, [], "no verification RPC while on");

    // The admin views do not take balance leases either.
    assertEquals((await h.req("/api/admin/dashboard", { token: admin })).status, 200);
    assertEquals(
      (await h.req(`/api/admin/initiatives/${initiative.id}`, { token: admin })).status,
      200,
    );
    assertEquals(h.script.calls, [], "no balance RPC from the admin views while on");
    await refreshDailyCache(h.deps, "production");
    assertEquals(h.fetchLog, [], "the cron does nothing while on");

    await h.req("/api/admin/maintenance/exit", { method: "POST", token: admin, json: {} });
    assertEquals((await j(await h.req(`/api/donate/status/${TX1}`))).status, "confirmed");
    assert(h.script.calls.length > 0, "verification resumes after exit");
    await h.req("/api/board?refresh=1");
    assertEquals(h.fetchLog.length, 1, "the ledger sync resumes after exit");
    assert((await h.db.meta.safeSync(initiative.id))!.ok);
  } finally {
    h.close();
  }
});

Deno.test("maintenance: another isolate sees the change within the cache window", async () => {
  const h = await harness();
  try {
    const other = createMaintenance(h.db, () => h.clock.now);
    assertEquals(await other.fresh(), OFF);
    await h.deps.maintenance.enter(ADMIN, "");
    assertEquals(await other.on(), true, "a cold cache reads KV");
    await h.deps.maintenance.exit();
    const exitedAt = h.clock.now;
    assertEquals(await other.on(), true, "a warm cache lags");
    h.clock.now += MAINTENANCE_CACHE_SECS;
    assertEquals(await other.on(), false);
    assertEquals(await other.fresh(), { on: false, by: ADMIN, at: exitedAt, note: "" });
  } finally {
    h.close();
  }
});
