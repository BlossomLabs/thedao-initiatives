import { assertEquals, assertStringIncludes } from "@std/assert";
import { TOKENS } from "../config.ts";
import { commentRoles, voteEligible } from "../services/roles.ts";
import { syncSafe } from "../services/safe-api.ts";
import { harness, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";

const A = "0x4444444444444444444444444444444444444444";
const B = "0x5555555555555555555555555555555555555555";
const TX = "0x" + "ef".repeat(32);

Deno.test("ERC-20 batches preserve funding without assigning mixed senders to one donor", async () => {
  for (const sameSender of [false, true]) {
    for (const reverse of [false, true]) {
      const h = await harness();
      try {
        const initiative = await h.db.initiatives.insert({
          title: "Batch attribution",
          status: "approved",
          safeAddress: SAFE_ADDR,
        });
        const logs = [
          transferLog(TOKENS.USDC[0], A, SAFE_ADDR, 1_000_000n),
          transferLog(TOKENS.USDC[0], sameSender ? A : B, SAFE_ADDR, 24_000_000n),
        ];
        if (reverse) logs.reverse();
        // Other recipients and other tokens must not pollute the selected token's senders.
        logs.push(transferLog(TOKENS.USDC[0], B, B, 100_000_000n));
        logs.push(transferLog(TOKENS.DAI[0], B, SAFE_ADDR, 10n ** 18n));
        h.script.receipts[TX] = { status: "0x1", blockNumber: "0x1f4", logs };
        for (let repeat = 0; repeat < 2; repeat++) {
          const response = await h.req("/api/donate/confirm", {
            method: "POST",
            json: { slug: initiative.slug, txHash: TX },
          });
          assertEquals(response.status, 200);
          assertEquals((await response.json()).status, "confirmed");
        }
        const row = (await h.db.donations.get(initiative.id, TX))!;
        assertEquals(row.amountRaw, "25000000");
        assertEquals(row.donor.toLowerCase(), sameSender ? A : "");
        assertEquals(await h.db.donations.confirmedTotal(initiative.id), 25);
        assertEquals(await h.db.donations.totalFor(initiative.id, A), sameSender ? 25 : 0);
        assertEquals(await h.db.donations.totalFor(initiative.id, B), 0);
        assertEquals(await voteEligible(h.deps, A, initiative.id, false), sameSender);
        assertEquals(await voteEligible(h.deps, B, initiative.id, false), false);
        assertEquals(
          await commentRoles(h.deps, A, initiative.id, false),
          sameSender ? ["DONOR"] : [],
        );
        if (!sameSender) assertStringIncludes(row.detail, "donor credit is unattributed");
      } finally {
        h.close();
      }
    }
  }
});

Deno.test("internal ETH batches do not assign every sender's credit to the first indexer row", async () => {
  const h = await harness({
    fetch: () =>
      Response.json({
        next: null,
        results: [A, B].map((from) => ({
          type: "ETHER_TRANSFER",
          transactionHash: TX,
          blockNumber: 500,
          from,
          to: SAFE_ADDR,
          value: "1000000000000000000",
          tokenAddress: null,
        })),
      }),
  });
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Internal batch attribution",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX] = { status: "0x1", blockNumber: "0x1f4", logs: [] };
    h.script.txs[TX] = { to: A, from: A, value: "0x0" };
    await syncSafe(h.deps, initiative);
    const row = (await h.db.donations.get(initiative.id, TX))!;
    assertEquals(row.status, "confirmed");
    assertEquals(row.amountUsd, 4000);
    assertEquals(row.donor, "");
    assertEquals(await voteEligible(h.deps, A, initiative.id, false), false);
    assertEquals(await h.db.donations.totalFor(initiative.id, B), 0);
  } finally {
    h.close();
  }
});
