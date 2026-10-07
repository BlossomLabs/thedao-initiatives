/** These isolated tests PASS when the reported defects exist.
 * All upstream responses and credentials are synthetic; no network calls are made. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { encodeErrorResult, encodeFunctionData, parseAbi } from "viem";
import { ADMIN, harness, j, PLAIN, testConnection } from "../../../../api/tests/app-helpers.ts";
import { SESSION_REAUTH_SECS } from "../../../../api/config.ts";
import { createEns, onchainEns } from "../../../../api/services/ens.ts";
import { ADMINS_META_KEY } from "../../../../api/services/admins.ts";
import { createApp } from "../../../../api/app.ts";

Deno.test("OCT-01: real ENS/viem path follows resolver gateways to private HTTP destinations", async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  const gateways: { url: string; init?: RequestInit }[] = [];
  const offchainAbi = parseAbi([
    "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
  ]);
  const batchAbi = parseAbi([
    "function query((address sender, string[] urls, bytes data)[] queries) view returns (bool[] failures, bytes[] responses)",
  ]);
  const resolver = "0x1111111111111111111111111111111111111111" as const;
  let target = "http://127.0.0.1:8888/internal/{data}";
  let calls = 0;
  const rpcFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = input instanceof Request ? await input.text() : String(init?.body);
    const req = JSON.parse(body);
    calls++;
    if (calls % 2 === 1) {
      // Model the Universal Resolver's actual local-batch gateway envelope,
      // which carries a user-controlled resolver's nested gateway URL.
      const data = encodeErrorResult({
        abi: offchainAbi,
        errorName: "OffchainLookup",
        args: [
          req.params[0].to,
          ["x-batch-gateway:true"],
          encodeFunctionData({
            abi: batchAbi,
            functionName: "query",
            args: [[{ sender: resolver, urls: [target], data: "0x1234" }]],
          }),
          "0x12345678",
          "0x",
        ],
      });
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: 3, message: "execution reverted", data },
      }));
    }
    // Reject the callback after the HTTP request: final ENS failure does not undo SSRF.
    return Promise.resolve(Response.json({ jsonrpc: "2.0", id: req.id, result: "0x" }));
  }) as typeof fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    gateways.push({ url: String(input), init });
    return Promise.resolve(Response.json({ data: "0x1234" }));
  }) as typeof fetch;
  try {
    const ens = onchainEns(["https://rpc.example.test"], rpcFetch);
    // The public route needs no application login. Simulated reverse ENS
    // callback failure is handled safely, but its gateway has already been fetched.
    h.deps.ens = createEns(h.deps.fetch, h.deps.now, { onchain: ens });
    const res = await createApp(h.deps).request(
      `http://api.test/api/ens-name/${PLAIN}`,
      undefined,
      testConnection(),
    );
    assertEquals(res.status, 200);
    assertEquals(gateways[0].url, "http://127.0.0.1:8888/internal/0x1234");
    assertEquals(gateways[0].init?.method, "GET");
    assertEquals(gateways[0].init?.signal, undefined);
    assertEquals(gateways[0].init?.redirect, undefined);
    target = "http://169.254.169.254/metadata";
    await ens.address("attacker.eth").catch(() => null);
    assertEquals(gateways[1].url, target);
    assertEquals(gateways[1].init?.method, "POST");
    assertEquals(JSON.parse(String(gateways[1].init?.body)), {
      data: "0x1234",
      sender: resolver,
    });
    console.log(JSON.stringify({
      finding: "OCT-01",
      publicStatus: res.status,
      gatewayRequests: gateways.map(({ url, init }) => ({
        url,
        method: init?.method,
        hasDeadline: Boolean(init?.signal),
        redirect: init?.redirect ?? "default (follow)",
      })),
    }));
  } finally {
    globalThis.fetch = originalFetch;
    h.close();
  }
});

Deno.test("OCT-02: stale administrator reads private leads through alternative endpoints", async () => {
  const h = await harness();
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Synthetic private fields fixture",
      status: "approved",
      proposer: PLAIN,
      funders: "PRIVATE-FUNDER-MARKER",
      contact: "PRIVATE-CONTACT-MARKER",
    });
    const admin = await h.mint(ADMIN, true);
    h.clock.now += SESSION_REAUTH_SECS + 1;
    const challenged = await h.req("/api/admin/leads", { token: admin });
    assertEquals(challenged.status, 403);
    assertEquals((await j(challenged)).reauthenticate, true);
    const paths = [
      `/api/admin/initiatives/${initiative.id}`,
      `/api/initiatives/${initiative.slug}`,
      `/initiative/${initiative.slug}-PRIVATE.md`,
    ];
    for (const path of paths) {
      const res = await h.req(path, { token: admin });
      assertEquals(res.status, 200, path);
      const body = await res.text();
      assertStringIncludes(body, "PRIVATE-FUNDER-MARKER", path);
      assertStringIncludes(body, "PRIVATE-CONTACT-MARKER", path);
    }
    // The public/ordinary-user boundary still works.
    const publicBody = await (await h.req(`/api/initiatives/${initiative.slug}`)).text();
    assert(!publicBody.includes("PRIVATE-FUNDER-MARKER"));
    assertEquals((await h.req(paths[2])).status, 401);
    console.log(
      JSON.stringify({
        finding: "OCT-02",
        authAge: SESSION_REAUTH_SECS + 1,
        leadsStatus: challenged.status,
        alternativeStatuses: paths.map((path) => ({ path, status: 200 })),
      }),
    );
  } finally {
    h.close();
  }
});

Deno.test("OCT-03: concurrent admin addition overwrites a successful administrator removal", async () => {
  const h = await harness();
  const addedWallet = "0x3333333333333333333333333333333333333333";
  try {
    await h.deps.admins.add(PLAIN);
    const oldToken = await h.mint(PLAIN, true);
    const admin = await h.mint(ADMIN, true);
    const originalSet = h.db.meta.set;
    let releaseAdd!: () => void;
    let additionRead!: () => void;
    const addRead = new Promise<void>((resolve) => additionRead = resolve);
    const resume = new Promise<void>((resolve) => releaseAdd = resolve);
    h.db.meta.set = async (key, value) => {
      if (key === ADMINS_META_KEY && Array.isArray(value) && value.includes(addedWallet)) {
        additionRead();
        await resume; // Realistic preemption after the unprotected read, before its write.
      }
      return await originalSet(key, value);
    };
    const adding = h.req("/api/admin/admins", {
      method: "POST",
      token: admin,
      json: { address: addedWallet },
    });
    await addRead;
    const removed = await h.req(`/api/admin/admins/${PLAIN}`, {
      method: "DELETE",
      token: admin,
      json: {},
    });
    assertEquals(removed.status, 200);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), false);
    releaseAdd();
    const added = await adding;
    assertEquals(added.status, 200);
    assertEquals(await h.deps.admins.isAdmin(PLAIN), true);
    assertEquals((await h.req("/api/admin/admins", { token: oldToken })).status, 401);
    // Simulate normal fresh authentication's membership lookup and issuance.
    const fresh = await h.mint(PLAIN, await h.deps.admins.isAdmin(PLAIN));
    const access = await h.req("/api/admin/admins", { token: fresh });
    assertEquals(access.status, 200);
    console.log(
      JSON.stringify({
        finding: "OCT-03",
        removeStatus: removed.status,
        addStatus: added.status,
        removedWalletIsAdminAgain: true,
        oldSessionStatus: 401,
        newSessionAdminAccess: access.status,
      }),
    );
  } finally {
    h.close();
  }
});
