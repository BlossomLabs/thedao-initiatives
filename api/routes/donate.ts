import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireClientIp } from "../middleware/ip.ts";
import { assertInitiativeIdentity } from "../lib/initiative-identity.ts";
import { assertFields, jsonBody, s } from "../lib/body.ts";
import { tokenQty } from "../lib/json.ts";
import { decimalsOf } from "./initiatives.ts";
import { CHAIN_ID, MIN_ETH_DONATION } from "../config.ts";
import { addrEq, isAddress, toChecksum } from "../chain/address.ts";
import { bodyLimit } from "hono/body-limit";
import type { ExchangeDetails, WalletIntent } from "../../shared/terms.ts";
import { publishedDonationTerms } from "../services/donation-terms.ts";
import { donationSession, requireDonationOrigin } from "../lib/donation-session.ts";
import { matchDonation } from "../services/donation-matching.ts";

const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
const ATTEMPT_RE = /^[A-Za-z0-9_-]{43}$/;

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === "") return undefined;
  // deno-lint-ignore no-control-regex -- reject controls in private donor labels
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, "Invalid donation details");
  }
  return value.trim() || undefined;
}

export function donateRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, chain } = deps;

  r.use(
    "/accept",
    bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: "request too large" }, 413) }),
  );
  r.use(
    "/confirm",
    bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: "request too large" }, 413) }),
  );

  r.post("/accept", async (c) => {
    requireDonationOrigin(c, deps);
    if (!(await db.rateLimit("checkbox:" + requireClientIp(c), 30, 3600))) {
      throw new HttpError(429, "slow down");
    }
    const body = await jsonBody(c, [
      "slug",
      "initiativeId",
      "chainId",
      "recipient",
      "version",
      "agreed",
      "method",
      "wallet",
      "details",
    ]);
    if (
      body.agreed !== true || body.chainId !== CHAIN_ID ||
      !["wallet", "exchange"].includes(String(body.method))
    ) {
      throw new HttpError(400, "Please agree to the donation terms first.");
    }
    const initiative = await db.initiatives.bySlug(s(body.slug, 200));
    if (!initiative || initiative.status !== "approved" || !initiative.safeAddress) {
      throw new HttpError(404, "not found");
    }
    await assertInitiativeIdentity(db, initiative.slug, initiative, body.initiativeId);
    if (typeof body.recipient !== "string" || !addrEq(body.recipient, initiative.safeAddress)) {
      throw new HttpError(409, "Donation address changed. Refresh the page before continuing.");
    }
    const published = (await publishedDonationTerms()).find((v) => v.id === body.version);
    if (
      !published || published.effectiveDate > new Date(db.now() * 1000).toISOString().slice(0, 10)
    ) {
      throw new HttpError(400, "Unknown or not yet effective donation terms");
    }
    let wallet: WalletIntent | undefined;
    let details: ExchangeDetails | undefined;
    if (body.method === "wallet") {
      if (
        body.details !== undefined || !body.wallet || typeof body.wallet !== "object" ||
        Array.isArray(body.wallet)
      ) {
        throw new HttpError(400, "Invalid wallet intent");
      }
      const w = body.wallet as Record<string, unknown>;
      assertFields(w, ["address", "token", "amountRaw"], "wallet.");
      const tokens = await chain.donorTokens();
      if (
        typeof w.address !== "string" || !isAddress(w.address) || typeof w.token !== "string" ||
        !Object.values(tokens).some(([address]) =>
          address.toLowerCase() === String(w.token).toLowerCase()
        ) ||
        typeof w.amountRaw !== "string" || !/^[1-9][0-9]{0,77}$/.test(w.amountRaw) ||
        BigInt(w.amountRaw) >= 2n ** 256n
      ) {
        throw new HttpError(400, "Invalid wallet intent");
      }
      const afterBlock = await chain.blockNumber();
      if (!Number.isSafeInteger(afterBlock) || afterBlock <= 0) {
        throw new HttpError(503, "Chain unavailable");
      }
      wallet = {
        address: toChecksum(w.address),
        token: w.token.toLowerCase(),
        amountRaw: w.amountRaw,
        afterBlock,
      };
    } else {
      if (body.wallet !== undefined) throw new HttpError(400, "Unexpected wallet intent");
      if (body.details !== undefined) {
        if (!body.details || typeof body.details !== "object" || Array.isArray(body.details)) {
          throw new HttpError(400, "Invalid donation details");
        }
        const d = body.details as Record<string, unknown>;
        assertFields(d, ["name", "amount", "currency"], "details.");
        details = {
          name: optionalText(d.name, 120),
          amount: optionalText(d.amount, 80),
          currency: optionalText(d.currency, 12),
        };
        if (details.amount && !/^(?:0|[1-9][0-9]{0,59})(?:\.[0-9]{1,18})?$/.test(details.amount)) {
          throw new HttpError(400, "Invalid amount");
        }
        if (
          details.currency && !Object.keys(await chain.donorTokens()).includes(details.currency)
        ) throw new HttpError(400, "Invalid currency");
      }
    }
    const sessionHash = await donationSession(c, deps, true);
    if (!(await db.rateLimit("checkbox-session:" + sessionHash, 30, 3600))) {
      throw new HttpError(429, "slow down");
    }
    const row = await db.terms.record({
      sessionHash,
      initiativeId: initiative.id,
      chainId: CHAIN_ID,
      recipient: initiative.safeAddress,
      version: published.id,
      method: body.method as "wallet" | "exchange",
      wallet,
      details,
    });
    return c.json({ attemptId: row.id, recordedAt: row.recordedAt });
  });

  // Private recovery endpoint; never expose acceptance events or volunteered names publicly.
  r.get("/attempt/:id", async (c) => {
    const sessionHash = await donationSession(c, deps);
    const id = c.req.param("id");
    const row = ATTEMPT_RE.test(id) ? await db.terms.get(id) : null;
    if (!row || row.sessionHash !== sessionHash) throw new HttpError(404, "not found");
    const { sessionHash: _sessionHash, ...acceptance } = row;
    return c.json({ acceptance, association: await db.terms.association(id) });
  });

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
    if (!(await db.rateLimit("confirm:" + requireClientIp(c), 30, 600))) {
      throw new HttpError(429, "slow down");
    }
    const body = await jsonBody(c, ["slug", "initiativeId", "txHash", "attemptId"]);
    const slug = s(body.slug, 200);
    const txHash = s(body.txHash, 80).toLowerCase();
    const initiative = await db.initiatives.bySlug(slug);
    if (!initiative) throw new HttpError(404, "not found");
    await assertInitiativeIdentity(db, slug, initiative, body.initiativeId);
    if (initiative.status !== "approved") throw new HttpError(404, "not found");
    if (!initiative.safeAddress) {
      return c.json({
        status: "error",
        detail: "this initiative has no donation address yet",
      }, 503);
    }
    if (!TX_HASH_RE.test(txHash)) throw new HttpError(400, "malformed transaction hash");
    let association;
    if (body.attemptId !== undefined) {
      requireDonationOrigin(c, deps);
      const sessionHash = await donationSession(c, deps);
      const id = body.attemptId;
      const row = typeof id === "string" && ATTEMPT_RE.test(id) ? await db.terms.get(id) : null;
      if (!row || row.sessionHash !== sessionHash) throw new HttpError(404, "not found");
      if (
        row.initiativeId !== initiative.id || row.chainId !== CHAIN_ID ||
        !addrEq(row.recipient, initiative.safeAddress)
      ) {
        throw new HttpError(
          409,
          "Donation attempt belongs to a different initiative or recipient.",
        );
      }
      // Persist the hash before RPC work: refreshes can retry even if this request fails.
      association = await db.terms.attach(row, txHash);
    }
    const state = await chain.state();
    if (!Object.keys(await chain.activeTokens()).length) {
      return c.json({ status: "error", detail: state.detail }, 503);
    }
    const v = await chain.verifyDonation(txHash, initiative.safeAddress);
    if (!v.found && v.detail.includes("malformed")) {
      return c.json({ status: "error", detail: v.detail }, 400);
    }
    if (association) await matchDonation(db, association, v);
    let [, status] = await db.donations.record(initiative.id, txHash, v, "tx");
    if (status === "confirmed") await deps.funding.invalidate(initiative.safeAddress);
    if (status === "already-confirmed") status = "confirmed";
    return c.json({
      status,
      association: association ? await db.terms.association(association.attemptId) : undefined,
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
    if (
      row.status === "pending" && !(await deps.maintenance.on()) &&
      (await db.rateLimit("st:" + txHash, 1, 5))
    ) {
      const initiative = await db.initiatives.get(row.rfpId);
      if (initiative?.safeAddress && Object.keys(await chain.activeTokens()).length) {
        const v = await chain.verifyDonation(txHash, initiative.safeAddress);
        if (v.found && !v.pending) {
          await db.donations.record(initiative.id, txHash, v, row.source);
          if (v.ok) await deps.funding.invalidate(initiative.safeAddress);
          row = (await db.donations.get(initiative.id, txHash)) ?? row;
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
