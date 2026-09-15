/** Support widget categories, shared by the panel (labels) and the API (message tag). */
export const SUPPORT_CATEGORIES = {
  problem: "Report a problem",
  idea: "Suggest an improvement",
  other: "Something else",
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

export const SUPPORT_CATEGORY_KEYS = Object.keys(SUPPORT_CATEGORIES) as SupportCategory[];

export function isSupportCategory(v: unknown): v is SupportCategory {
  return typeof v === "string" && v in SUPPORT_CATEGORIES;
}

export const SUPPORT_MESSAGE_MAX = 4000;
/** Data-URL JPEG from the page capture; the API's body limit is 2 MB. */
export const SUPPORT_SCREENSHOT_MAX = 1_500_000;
