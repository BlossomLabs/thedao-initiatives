/**
 * Initiative categories, shared by the API (validation, AI suggestion, feeds)
 * and the app (tags, filters). Order is display order. Slugs are permanent:
 * they live in stored rows and shared URLs, so rename a label, never a slug.
 * Icons are lucide names; the app maps them to components.
 */
export interface Category {
  slug: string;
  label: string;
  description: string;
  icon: string;
  /** Tag colour; dark and light text variants meet contrast on card surfaces. */
  base: string;
  darkText: string;
  lightText: string;
}

export const CATEGORIES = [
  {
    slug: "compilers",
    label: "Compilers & Languages",
    description: "Compilers, languages and the toolchain that turns source into bytecode.",
    icon: "code-xml",
    base: "#6D8CFF",
    darkText: "#96ACFF",
    lightText: "#4E65B8",
  },
  {
    slug: "formal-verification",
    label: "Formal Verification",
    description: "Machine-checked proofs and specifications of code and protocols.",
    icon: "sigma",
    base: "#A06CFF",
    darkText: "#BE9BFF",
    lightText: "#7A52C2",
  },
  {
    slug: "fuzzing-testing",
    label: "Fuzzing & Testing",
    description: "Fuzzers, test suites and differential testing.",
    icon: "flask-conical",
    base: "#FF6EC7",
    darkText: "#FF85D0",
    lightText: "#A64781",
  },
  {
    slug: "audits-analysis",
    label: "Audits & Analysis",
    description: "Audits, static analysis, decompilers and review tooling.",
    icon: "scan-search",
    base: "#FFCF3A",
    darkText: "#FFCF3A",
    lightText: "#856C1E",
  },
  {
    slug: "wallets-signing",
    label: "Wallets & Signing",
    description: "Wallets, multisigs, key management and safe transaction signing.",
    icon: "key-round",
    base: "#00D2B8",
    darkText: "#00D2B8",
    lightText: "#007A6B",
  },
  {
    slug: "opsec",
    label: "OpSec",
    description: "Operational security for teams and people: devices, hiring, coercion.",
    icon: "lock-keyhole",
    base: "#FF3B38",
    darkText: "#FF807E",
    lightText: "#C22D2B",
  },
  {
    slug: "detection-response",
    label: "Detection & Response",
    description: "Monitoring, exploit alerts, forensics and incident response.",
    icon: "siren",
    base: "#FF8A3D",
    darkText: "#FF9650",
    lightText: "#A15726",
  },
  {
    slug: "defi",
    label: "DeFi Safety",
    description: "Safety of DeFi protocols, vaults, hooks and their users.",
    icon: "coins",
    base: "#A8E05F",
    darkText: "#A8E05F",
    lightText: "#597732",
  },
  {
    slug: "infrastructure",
    label: "Infrastructure & Clients",
    description: "Clients, light clients, RPC, ENS and the infrastructure apps rely on.",
    icon: "server",
    base: "#5AC8FA",
    darkText: "#5AC8FA",
    lightText: "#2C5E86",
  },
  {
    slug: "research-education",
    label: "Research & Education",
    description: "Research, handbooks, news and training.",
    icon: "book-open",
    base: "#5CB75A",
    darkText: "#78C376",
    lightText: "#3C773A",
  },
] as const satisfies readonly Category[];

export type CategorySlug = typeof CATEGORIES[number]["slug"];

export const MAX_CATEGORIES = 3;

const BY_SLUG = new Map<string, Category>(CATEGORIES.map((c) => [c.slug, c]));

export const categoryOf = (slug: string): Category | undefined => BY_SLUG.get(slug);

export const isCategorySlug = (v: unknown): v is CategorySlug =>
  typeof v === "string" && BY_SLUG.has(v);

/** A stored row's categories: rows written before categories existed have none. */
export const categoriesOf = (r: { categories?: readonly string[] }): string[] =>
  (r.categories ?? []).filter((s) => BY_SLUG.has(s));

/**
 * A client's category list: 1 to 3 unique registry slugs, first is primary.
 * Returns the error message for a 400, never a partial list.
 */
export function readCategories(raw: unknown): [string[], null] | [null, string] {
  if (!Array.isArray(raw)) return [null, "Categories must be a list."];
  if (!raw.length) return [null, "Pick at least one category."];
  if (raw.length > MAX_CATEGORIES) {
    return [null, `Pick at most ${MAX_CATEGORIES} categories.`];
  }
  const unknown = raw.filter((v) => !isCategorySlug(v));
  if (unknown.length) return [null, `Unknown category: ${String(unknown[0]).slice(0, 40)}.`];
  if (new Set(raw).size !== raw.length) return [null, "Each category can be picked once."];
  return [raw as string[], null];
}
