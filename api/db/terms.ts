import type { CheckboxAcceptance, DonationAssociation } from "../../shared/terms.ts";
import { HttpError } from "../lib/errors.ts";
import { randomToken, sha256Hex } from "../lib/ids.ts";
import { K } from "./keys.ts";

export const CHECKBOX_SESSION_SECS = 7 * 86400;

/** Browser evidence has its own namespace. Never overwrite historical signed or legacy records. */
export function termsRepo(kv: Deno.Kv, now: () => number) {
  async function session(token: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = sha256Hex(token);
    const entry = await kv.get<number>(K.checkboxSession(hash));
    return entry.value && entry.value > now() ? hash : null;
  }
  async function createSession() {
    const token = randomToken();
    const hash = sha256Hex(token);
    await kv.set(K.checkboxSession(hash), now() + CHECKBOX_SESSION_SECS, {
      expireIn: CHECKBOX_SESSION_SECS * 1000,
    });
    return { token, hash };
  }
  async function record(
    input: Omit<CheckboxAcceptance, "id" | "recordedAt" | "evidence" | "donorAuthenticated">,
  ) {
    const row: CheckboxAcceptance = {
      ...input,
      id: randomToken(),
      recordedAt: now(),
      evidence: "browser-checkbox-v1",
      donorAuthenticated: false,
    };
    await kv.set(K.checkboxAcceptance(row.id), row);
    return row;
  }
  const get = async (id: string) =>
    (await kv.get<CheckboxAcceptance>(K.checkboxAcceptance(id))).value;
  const association = async (id: string) =>
    (await kv.get<DonationAssociation>(K.donationAssociation(id))).value;

  async function attach(row: CheckboxAcceptance, txHash: string) {
    const key = K.donationAssociation(row.id);
    const previous = await kv.get<DonationAssociation>(key);
    if (previous.value) {
      if (previous.value.txHash !== txHash) {
        throw new HttpError(
          409,
          "This attempt already has a transaction. Start a new attempt for another transfer.",
        );
      }
      return previous.value;
    }
    if (now() - row.recordedAt > CHECKBOX_SESSION_SECS) {
      throw new HttpError(410, "This donation attempt has expired. Start a new attempt.");
    }
    const link: DonationAssociation = {
      attemptId: row.id,
      initiativeId: row.initiativeId,
      chainId: row.chainId,
      recipient: row.recipient,
      txHash,
      submittedAt: now(),
      state: "pending",
      evidence: row.method === "wallet" ? "wallet-flow-correlated" : "visitor-reported",
      donorAuthenticated: false,
    };
    const result = await kv.atomic().check(previous)
      .set(key, link)
      .set(K.pendingAssociation(row.initiativeId, row.id), true).commit();
    if (!result.ok) return await attach(row, txHash);
    return link;
  }

  async function resolve(
    id: string,
    state: Exclude<DonationAssociation["state"], "pending">,
    detail: string,
  ) {
    const key = K.donationAssociation(id);
    const entry = await kv.get<DonationAssociation>(key);
    if (!entry.value || entry.value.state !== "pending") return;
    await kv.atomic().check(entry)
      .set(key, { ...entry.value, state, detail, checkedAt: now() })
      .delete(K.pendingAssociation(entry.value.initiativeId, id)).commit();
  }
  async function pending(initiativeId: string, limit = 30) {
    const out: DonationAssociation[] = [];
    for await (
      const entry of kv.list({ prefix: ["pending_association", initiativeId] }, { limit })
    ) {
      const row = await association(String(entry.key[2]));
      if (row?.state === "pending") out.push(row);
    }
    return out;
  }
  return { session, createSession, record, get, attach, association, resolve, pending };
}
