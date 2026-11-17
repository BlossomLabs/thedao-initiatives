import { assert, assertEquals } from "@std/assert";
import { decodeFunctionData, zeroHash } from "viem";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import type { VoteChain } from "../services/vote-chain.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";

Deno.test("correction batches require admins, fresh authentication, current settings and valid inputs", async () => {
  const h = await harness();
  const now = h.clock.now;
  const m: VoteManifest = {
    kind: "test",
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    configRevision: "4",
    opensAt: now - 10,
    closesAt: now + 1000,
    schedule: {
      opensAt: now - 10,
      firstTallyAt: [now + 100, now + 400, now + 700],
      initialWindow: 100,
      maxWindows: 1,
    },
    poolUsd: "0",
    slugs: ["alpha"],
    accounts: ["0x2000000000000000000000000000000000000002"],
    projects: [{ goalUsd: "1000000", rfp: false, groups: [] }],
    groups: ["Old"],
    independentTiers: 1,
  };
  h.deps.vote = {
    manifest: m,
    states: () =>
      Promise.resolve([{
        block: 1,
        timestamp: now - 1,
        poolUsd: 0n,
        poolInitialized: true,
        asks: [1_000_000n],
        withdrawn: [],
        event: false,
      }]),
    chain: {
      ballots: () => Promise.resolve({ events: [], block: 1n }),
      committed: () => Promise.resolve({ transcript: zeroHash, recordCount: 0n, hashes: [] }),
      rulesHistory: () => Promise.resolve({ addedAt: [], pool: [] }),
      corrections: () =>
        Promise.resolve({ poolUsd: "0", pendingPoolUsd: null, poolUpdateNonce: "0" }),
    } as unknown as VoteChain,
  };
  try {
    const admin = await h.mint(ADMIN, true);
    const path = "/api/admin/vote-round/corrections";
    const json = { action: "group", revision: "4", id: "0", name: "Corrected" };
    const post = (body: unknown, token = admin) =>
      h.req(path, { method: "POST", token, json: body });
    assertEquals((await post(json, await h.mint(PLAIN))).status, 403);
    assertEquals((await post({ ...json, revision: "3" })).status, 400);
    assertEquals((await post({ ...json, action: "arbitraryCall", to: ADMIN })).status, 400);
    const response = await post(json);
    assertEquals(response.status, 200);
    const result = await j(response) as {
      summary: string;
      batch: { transactions: { data: `0x${string}` }[] };
    };
    assert(result.summary.includes("Old → Corrected"));
    assertEquals(
      result.batch.transactions.map((t) =>
        decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: t.data }).functionName
      ),
      ["requireConfigRevision", "setGroupName"],
    );
    const got = await h.req(path, { token: admin });
    assertEquals(got.status, 200);
    assertEquals((await j(got) as { supported: boolean }).supported, true);
    // An authenticated admin without a recent sign-in cannot prepare a batch.
    const stale = await h.mint(ADMIN, true);
    h.clock.now += 3600;
    assertEquals((await post(json, stale)).status, 403);
  } finally {
    await h.settle();
    h.close();
  }
});
