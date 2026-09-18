import type { Db } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";
import type { Verification } from "../chain/verify.ts";
import type { DonationAssociation } from "../../shared/terms.ts";
import { addrEq } from "../chain/address.ts";

/** Chain verification proves the transfer only. Browser associations never authenticate donors. */
export async function matchDonation(db: Db, link: DonationAssociation, v: Verification) {
  if (link.state !== "pending") return;
  const acceptance = await db.terms.get(link.attemptId);
  if (!acceptance) return;
  if (!v.ok) {
    if (v.found && !v.pending) await db.terms.resolve(link.attemptId, "unmatched", v.detail);
    return;
  }
  const intent = acceptance.wallet;
  const matched = acceptance.method === "exchange" || Boolean(
    intent && v.singleTransfer &&
      v.blockNumber && v.blockNumber > intent.afterBlock &&
      addrEq(v.donor, intent.address) &&
      (v.tokenAddress || "native").toLowerCase() === intent.token.toLowerCase() &&
      v.amountRaw === intent.amountRaw,
  );
  await db.terms.resolve(
    link.attemptId,
    matched ? "matched" : "unmatched",
    matched
      ? "Transfer checked; browser association only, donor not authenticated."
      : "Transfer does not match the pre-recorded wallet details, timing, or single-transfer scope.",
  );
}

/** Runs during ledger refreshes (including the daily fallback), independent of browser polling. */
export async function retryDonationMatches(db: Db, chain: Chain, initiativeId: string) {
  for (const link of await db.terms.pending(initiativeId)) {
    if (db.now() - link.submittedAt > 7 * 86400) {
      await db.terms.resolve(
        link.attemptId,
        "expired",
        "Matching window expired; no donor authentication.",
      );
      continue;
    }
    try {
      const rfp = await db.initiatives.get(initiativeId);
      if (!rfp || rfp.status !== "approved" || !addrEq(rfp.safeAddress, link.recipient)) {
        await db.terms.resolve(link.attemptId, "unmatched", "Initiative or recipient changed.");
        continue;
      }
      const v = await chain.verifyDonation(link.txHash, link.recipient);
      await db.donations.record(initiativeId, link.txHash, v, "tx");
      await matchDonation(db, link, v);
    } catch { /* Leave queued for a later ledger refresh. */ }
  }
}
