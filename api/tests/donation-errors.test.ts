import { assertEquals } from "@std/assert";
import { verifyDonationTx } from "../chain/verify.ts";
import { TOKENS } from "../config.ts";
import { K } from "../db/keys.ts";
import { PRICE_UNAVAILABLE_DETAIL } from "../lib/donation-detail.ts";
import { donationJson } from "../lib/json.ts";
import { syncSafe } from "../services/safe-api.ts";
import { harness, SAFE_ADDR } from "./app-helpers.ts";
import { DONOR, fakeRpc, transferLog } from "./helpers.ts";

const TX = "0x" + "ab".repeat(32);
const secret = "SENTINEL_RPC_SECRET";
const price = () => Promise.reject(new Error(`https://rpc.invalid/v2/${secret}`));

Deno.test("donation pricing failures stay generic in confirmation, storage and public status", async () => {
  for (const token of ["ETH", "EURC"]) {
    const h = await harness();
    try {
      const initiative = await h.db.initiatives.insert({
        title: "Pricing errors",
        status: "approved",
        safeAddress: SAFE_ADDR,
      });
      const rpc = fakeRpc({
        eth_getTransactionReceipt: () => ({
          status: "0x1",
          blockNumber: "0x1f4",
          logs: token === "ETH" ? [] : [transferLog(TOKENS.EURC[0], DONOR, SAFE_ADDR, 1_000_000n)],
        }),
        eth_blockNumber: () => "0x3e8",
        eth_getTransactionByHash: () => ({
          to: SAFE_ADDR,
          from: DONOR,
          value: "0xde0b6b3a7640000",
        }),
      });
      h.deps.chain.verifyDonation = (hash, recipient, opts) =>
        verifyDonationTx(rpc, price, hash, recipient, TOKENS, opts);
      const response = await h.req("/api/donate/confirm", {
        method: "POST",
        json: { slug: initiative.slug, txHash: TX },
      });
      assertEquals(response.status, 200);
      assertEquals((await response.json()).detail, PRICE_UNAVAILABLE_DETAIL);
      const stored = (await h.db.donations.get(initiative.id, TX))!;
      assertEquals(stored.detail, PRICE_UNAVAILABLE_DETAIL);

      // A record made before this fix must be safe even when no retry can run.
      await h.kv.set(K.donation(initiative.id, TX), {
        ...stored,
        detail: `${PRICE_UNAVAILABLE_DETAIL}: ${secret}`,
      });
      h.deps.chain.activeTokens = () => Promise.resolve({});
      const status = await h.req(`/api/donate/status/${TX}`);
      assertEquals(status.status, 200);
      assertEquals((await status.json()).detail, PRICE_UNAVAILABLE_DETAIL);
      const legacy = (await h.db.donations.get(initiative.id, TX))!;
      assertEquals(donationJson(legacy, () => 18).detail, PRICE_UNAVAILABLE_DETAIL);
    } finally {
      h.close();
    }
  }
});

Deno.test("Safe indexer pricing failures never persist upstream error text", async () => {
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
          value: "1000000000000000000",
          tokenAddress: null,
        }],
      }),
  });
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Indexer pricing",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX] = { status: "0x1", blockNumber: "0x1f4", logs: [] };
    h.script.txs[TX] = { to: DONOR, value: "0x0" };
    h.deps.chain.usdRate = price;
    await syncSafe(h.deps, initiative);
    const stored = (await h.db.donations.get(initiative.id, TX))!;
    assertEquals(stored.status, "pending");
    assertEquals(stored.detail, PRICE_UNAVAILABLE_DETAIL);
  } finally {
    h.close();
  }
});
