import { assertEquals, assertStringIncludes } from "@std/assert";
import { syncSafe } from "../services/safe-api.ts";
import { harness, SAFE_ADDR } from "./app-helpers.ts";
import { DONOR } from "./helpers.ts";

const TX = "0x" + "cd".repeat(32);
const MIN_WEI = 500_000_000_000_000n;

Deno.test("Safe sync enforces the ETH minimum for direct and internal transfers", async () => {
  for (const internal of [false, true]) {
    for (const value of [MIN_WEI - 1n, MIN_WEI, MIN_WEI + 1n]) {
      const h = await harness({
        fetch: () =>
          Response.json({
            next: null,
            results: [{
              type: "ETHER_TRANSFER",
              transactionHash: TX,
              blockNumber: 500,
              from: DONOR,
              to: SAFE_ADDR,
              value: String(value),
              tokenAddress: null,
            }],
          }),
      });
      try {
        const initiative = await h.db.initiatives.insert({
          title: "ETH minimum",
          status: "approved",
          safeAddress: SAFE_ADDR,
        });
        h.script.receipts[TX] = { status: "0x1", blockNumber: "0x1f4", logs: [] };
        h.script.txs[TX] = {
          to: internal ? DONOR : SAFE_ADDR,
          from: DONOR,
          value: internal ? "0x0" : "0x" + value.toString(16),
        };
        // A manually submitted failed row must not bypass the same policy later.
        const v = await h.deps.chain.verifyDonation(TX, SAFE_ADDR);
        await h.db.donations.record(initiative.id, TX, v);
        await syncSafe(h.deps, initiative);
        const row = (await h.db.donations.get(initiative.id, TX))!;
        assertEquals(row.status, value < MIN_WEI ? "failed" : "confirmed");
        if (value < MIN_WEI) {
          assertStringIncludes(row.detail, "minimum donation of 0.0005 ETH");
          assertEquals(await h.db.donations.totalFor(initiative.id, DONOR), 0);
        } else {
          assertEquals(row.amountRaw, String(value));
          assertEquals(row.source, internal ? "safe-api" : "tx");
        }
      } finally {
        h.close();
      }
    }
  }
});

Deno.test("Safe indexer data cannot override reverted or unknown RPC transactions", async () => {
  for (const reverted of [true, false]) {
    const h = await harness({
      fetch: () =>
        Response.json({
          next: null,
          results: [{
            type: "ETHER_TRANSFER",
            transactionHash: TX,
            blockNumber: 500,
            from: DONOR,
            to: SAFE_ADDR,
            value: String(MIN_WEI),
            tokenAddress: null,
          }],
        }),
    });
    try {
      const initiative = await h.db.initiatives.insert({
        title: "Indexer cannot override rejection",
        status: "approved",
        safeAddress: SAFE_ADDR,
      });
      if (reverted) h.script.receipts[TX] = { status: "0x0", blockNumber: "0x1f4", logs: [] };
      await syncSafe(h.deps, initiative);
      const row = await h.db.donations.get(initiative.id, TX);
      assertEquals(row?.status ?? null, reverted ? "failed" : null);
      assertEquals(await h.db.donations.confirmedTotal(initiative.id), 0);
    } finally {
      h.close();
    }
  }
});
