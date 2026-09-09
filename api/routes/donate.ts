import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { tokenQty } from "../lib/json.ts";
import { decimalsOf } from "./initiatives.ts";
import { CHAIN_ID, MIN_ETH_DONATION } from "../config.ts";

export function donateRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, chain } = deps;

  /** Accepted tokens + USD rates (the same set for every initiative). */
  r.get("/params", async (c) => {
    const state = await chain.state();
    const tokens = await chain.donorTokens();
    if (!Object.keys(tokens).length) {
      return c.json({ enabled: false, reason: state.detail }, 503);
    }
    const priced: Record<string, { address: string; decimals: number }> = {};
    const rates: Record<string, number> = {};
    for (const [sym, [address, decimals]] of Object.entries(tokens)) {
      try {
        rates[sym] = await chain.usdRate(sym);
        priced[sym] = { address, decimals };
      } catch { /* cannot price it safely right now: do not offer it */ }
    }
    return c.json({
      enabled: true,
      chainId: CHAIN_ID,
      tokens: priced,
      rates,
      minTokenUnits: 1,
      minEth: MIN_ETH_DONATION,
    });
  });

  r.post("/confirm", async (c) => {
    if (!(await db.rateLimit("confirm:" + c.var.ip, 30, 600))) {
      throw new HttpError(429, "slow down");
    }
    const body = await jsonBody(c);
    const slug = s(body.slug, 200);
    const txHash = s(body.txHash, 80).toLowerCase();
    const rfp = await db.rfps.bySlug(slug);
    if (!rfp || rfp.status !== "approved") throw new HttpError(404, "not found");
    if (!rfp.safeAddress) {
      return c.json({
        status: "error",
        detail: "this initiative has no donation address yet",
      }, 503);
    }
    const state = await chain.state();
    if (!Object.keys(await chain.activeTokens()).length) {
      return c.json({ status: "error", detail: state.detail }, 503);
    }
    const v = await chain.verifyDonation(txHash, rfp.safeAddress);
    if (!v.found && v.detail.includes("malformed")) {
      return c.json({ status: "error", detail: v.detail }, 400);
    }
    let [, status] = await db.donations.record(rfp.id, txHash, v, "tx");
    if (status === "already-confirmed") status = "confirmed";
    return c.json({
      status,
      detail: v.detail,
      amount: v.amount,
      token: v.tokenSymbol,
      amountUsd: v.amountUsd,
    });
  });

  r.get("/status/:txHash", async (c) => {
    const txHash = c.req.param("txHash").trim().toLowerCase();
    let row = await db.donations.byHash(txHash);
    if (!row) throw new HttpError(404, "not found");
    if (row.status === "pending" && (await db.rateLimit("st:" + txHash, 1, 5))) {
      const rfp = await db.rfps.get(row.rfpId);
      if (rfp?.safeAddress && Object.keys(await chain.activeTokens()).length) {
        const v = await chain.verifyDonation(txHash, rfp.safeAddress);
        if (v.found && !v.pending) {
          await db.donations.record(rfp.id, txHash, v, row.source);
          row = (await db.donations.get(rfp.id, txHash)) ?? row;
        }
      }
    }
    return c.json({
      status: row.status,
      detail: row.detail,
      amount: tokenQty(row, decimalsOf),
      token: row.tokenSymbol,
      amountUsd: row.amountUsd,
    });
  });

  return r;
}
