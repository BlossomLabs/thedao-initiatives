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
import { CATEGORIES } from "@shared/categories";

export {
  CATEGORIES,
  categoriesOf,
  type Category,
  categoryOf,
  MAX_CATEGORIES,
} from "@shared/categories";

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
