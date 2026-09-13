import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { assertInitiativeIdentity } from "../lib/initiative-identity.ts";
import { jsonBody, s } from "../lib/body.ts";
import { tokenQty } from "../lib/json.ts";
import { decimalsOf } from "./initiatives.ts";
import { CHAIN_ID, MIN_ETH_DONATION } from "../config.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import type { TermsAcceptance } from "../db/terms.ts";

const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
const TERMS_VERSION_RE = /^[0-9a-f]{64}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** How far ahead of the server clock a donor's checkbox timestamp may be. */
const ACCEPTED_AT_SKEW_SECS = 300;

/**
 * The widget's `terms` block on a confirm: the version it displayed, when the
 * box was ticked, and the wallet connected at the time. Anything malformed is
 * a 400 rather than a silently dropped record, so a client bug cannot leave
 * donations without their acceptance.
 */
export function parseTermsAcceptance(
  raw: unknown,
  txHash: string,
  now: number,
): Omit<TermsAcceptance, "recordedAt"> {
  const bad = () => new HttpError(400, "bad terms acceptance");
  if (!TX_HASH_RE.test(txHash)) throw bad();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad();
  const t = raw as Record<string, unknown>;
  const version = s(t.version, 65);
  if (!TERMS_VERSION_RE.test(version)) throw bad();
  const acceptedAt = s(t.acceptedAt, 40);
  const acceptedSecs = Date.parse(acceptedAt) / 1000;
  if (!ISO_UTC_RE.test(acceptedAt) || Number.isNaN(acceptedSecs)) throw bad();
  if (acceptedSecs > now + ACCEPTED_AT_SKEW_SECS) throw bad();
  let address = s(t.address, 64);
  if (address) {
    if (!isAddress(address)) throw bad();
    address = toChecksum(address);
  }
  return { txHash, version, address, acceptedAt };
}

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
    if (!rfp) throw new HttpError(404, "not found");
    await assertInitiativeIdentity(db, slug, rfp, body.initiativeId);
    if (rfp.status !== "approved") throw new HttpError(404, "not found");
    if (!rfp.safeAddress) {
      return c.json({
        status: "error",
        detail: "this initiative has no donation address yet",
      }, 503);
    }
    // The donor's terms acceptance, bound to this tx before the chain is
    // consulted so an RPC outage cannot lose it. First write wins.
    if (body.terms !== undefined) {
      await db.terms.record(parseTermsAcceptance(body.terms, txHash, db.now()));
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
