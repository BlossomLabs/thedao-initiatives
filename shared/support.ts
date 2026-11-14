import { tooLong } from "./draft/caps.ts";

/** Support widget categories, shared by the panel (labels) and the API (message tag). */
export const SUPPORT_CATEGORIES = {
  problem: "Report a problem",
  idea: "Suggest an improvement",
  receipt: "Request a donation receipt",
  pledge: "Pledge to an Initiative",
  other: "Something else",
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

export const SUPPORT_CATEGORY_KEYS = Object.keys(SUPPORT_CATEGORIES) as SupportCategory[];

export function isSupportCategory(v: unknown): v is SupportCategory {
  return typeof v === "string" && Object.hasOwn(SUPPORT_CATEGORIES, v);
}

export const SUPPORT_MESSAGE_MAX = 4000;
export const SUPPORT_TRANSACTION_URL_MAX = 500;
export const PLEDGE_ORG_MAX = 160;
export const PLEDGE_CONTACT_MAX = 120;
export const PLEDGE_AMOUNT_MAX = 100_000_000;

/** USD, to the cent; accepts a dollar sign and grouping commas. */
export function parsePledgeAmount(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return amount > 0 && amount <= PLEDGE_AMOUNT_MAX ? amount : null;
}

/** Transaction links are forwarded as text; neither the API nor the widget fetches them. */
export function receiptTransactionError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Add the transaction link.";
  if (value.length > SUPPORT_TRANSACTION_URL_MAX) {
    return tooLong("The transaction link", SUPPORT_TRANSACTION_URL_MAX);
  }
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" && url.hostname.includes(".") &&
      !url.username && !url.password && !/\s/.test(value)
    ) return null;
  } catch { /* Show the same error for malformed and unsupported URLs. */ }
  return "Enter a valid https transaction link.";
}

/** Data-URL JPEG from the page capture; the API's body limit is 2 MB. */
export const SUPPORT_SCREENSHOT_MAX = 1_500_000;
