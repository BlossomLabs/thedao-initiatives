/** Shared canonical terms document parsing and checkbox evidence types. */
import { sha256, stringToBytes } from "viem";

export interface TermsVersion {
  /** YYYY-MM-DD, from the `version:` header line. */
  effectiveDate: string;
  /** 64 lowercase hex chars: sha256(effectiveDate + "\n" + body). */
  id: string;
  /** `material: true` in the header. */
  material: boolean;
  /** Markdown after the header lines. */
  body: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEADER_RE = /^([a-z]+):[ \t]*(.*?)[ \t]*$/;

/** Rejects day overflow such as 2026-02-30, which Date.parse would accept. */
function isRealDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function termsVersionId(effectiveDate: string, body: string): string {
  return sha256(stringToBytes(effectiveDate + "\n" + body)).slice(2);
}

export function parseTermsFile(text: string, name: string): TermsVersion {
  const where = `content/donation-terms/${name}`;
  const lines = text.split(/\r?\n/);
  let effectiveDate = "";
  let material = false;
  let i = 0;
  for (; i < lines.length && lines[i].trim() !== ""; i++) {
    const m = HEADER_RE.exec(lines[i]);
    if (!m) break;
    const [, key, value] = m;
    if (key === "version") effectiveDate = value;
    else if (key === "material") material = value === "true";
    else throw new Error(`${where}: unknown header \`${key}:\``);
  }
  if (!effectiveDate) throw new Error(`${where}: first line must be \`version: YYYY-MM-DD\``);
  if (!DATE_RE.test(effectiveDate)) {
    throw new Error(`${where}: version must be the effective date, YYYY-MM-DD`);
  }
  if (!isRealDate(effectiveDate)) throw new Error(`${where}: ${effectiveDate} is not a date`);
  if (name !== effectiveDate + ".md") {
    throw new Error(`${where}: file name must be ${effectiveDate}.md`);
  }
  const body = lines.slice(i).join("\n").trim();
  if (!body) throw new Error(`${where}: terms body is empty`);
  return { effectiveDate, id: termsVersionId(effectiveDate, body), material, body };
}

/** Volunteered exchange details are private, unverified matching hints. */
export interface ExchangeDetails {
  name?: string;
  amount?: string;
  currency?: string;
}

export interface WalletIntent {
  address: string;
  token: string;
  amountRaw: string;
  /** Chain head observed by the API before opening the wallet. */
  afterBlock: number;
}

export interface CheckboxAcceptance {
  id: string;
  sessionHash: string;
  initiativeId: string;
  chainId: number;
  recipient: string;
  version: string;
  recordedAt: number;
  method: "wallet" | "exchange";
  wallet?: WalletIntent;
  details?: ExchangeDetails;
  evidence: "browser-checkbox-v1";
  donorAuthenticated: false;
}

export interface DonationAssociation {
  attemptId: string;
  initiativeId: string;
  chainId: number;
  recipient: string;
  txHash: string;
  submittedAt: number;
  checkedAt?: number;
  state: "pending" | "matched" | "unmatched" | "expired";
  evidence: "wallet-flow-correlated" | "visitor-reported";
  donorAuthenticated: false;
  detail?: string;
}

export interface AcceptanceReceipt {
  attemptId: string;
  recordedAt: number;
}
