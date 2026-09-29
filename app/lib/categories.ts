import {
  BookOpen,
  CodeXml,
  Coins,
  FlaskConical,
  KeyRound,
  LockKeyhole,
  type LucideIcon,
  ScanSearch,
  Server,
  Sigma,
  Siren,
} from "lucide-react";
import { CATEGORIES, isCategorySlug, MAX_CATEGORIES } from "@shared/categories";

export {
  CATEGORIES,
  categoriesOf,
  type Category,
  categoryOf,
  isCategorySlug,
  MAX_CATEGORIES,
} from "@shared/categories";

/** A list from the client or storage: known slugs, first occurrence wins, at most three. */
export const normaliseCategories = (raw: readonly unknown[]): string[] =>
  [...new Set(raw.filter(isCategorySlug))].slice(0, MAX_CATEGORIES);

/** The registry names lucide icons; these are the components. */
const ICONS: Record<string, LucideIcon> = {
  "code-xml": CodeXml,
  sigma: Sigma,
  "flask-conical": FlaskConical,
  "scan-search": ScanSearch,
  "key-round": KeyRound,
  "lock-keyhole": LockKeyhole,
  siren: Siren,
  coins: Coins,
  server: Server,
  "book-open": BookOpen,
};

export const iconOf = (icon: string): LucideIcon => ICONS[icon] ?? BookOpen;

/** Registry position, for sorting "by category" in display order. */
export const CATEGORY_INDEX: Record<string, number> = Object.fromEntries(
  CATEGORIES.map((c, i) => [c.slug, i]),
);
