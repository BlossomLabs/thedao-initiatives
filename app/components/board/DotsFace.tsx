import { type Category, categoryOf, iconOf, MAX_CATEGORIES } from "~/lib/categories";

/** A card's known categories, at most three, in stored order (the first is primary). */
export const dotsOf = (slugs: string[]): Category[] =>
  slugs.slice(0, MAX_CATEGORIES).map((s) => categoryOf(s)).filter((c): c is Category => Boolean(c));

export const dotsLabel = (cats: Category[]) => `Categories: ${cats.map((c) => c.label).join(", ")}`;

/** The 24px icon button's look, shared by the real trigger and its stand-in. The
 * negative margins keep the 24px target without making the title line taller,
 * and pull the icon's edge flush with the card text; lifted 2px so the icon
 * centres on the capitals rather than on the line box. */
export const DOTS_BUTTON =
  "relative -top-0.5 -my-1 -ml-1 mr-1 inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 align-middle hover:bg-white/[.06] focus-visible:outline-2 focus-visible:outline-dao-bright data-[popup-open]:bg-white/[.08]";

/** A category's lucide icon in its colour. */
export function CategoryIcon({ cat, className = "size-4" }: { cat: Category; className?: string }) {
  const Icon = iconOf(cat.icon);
  return (
    <Icon
      aria-hidden="true"
      data-category={cat.slug}
      className={className}
      style={{ color: cat.darkText }}
      strokeWidth={2.2}
    />
  );
}

/** The trigger's face: the primary category's icon. */
export const Dots = ({ cats }: { cats: Category[] }) => <CategoryIcon cat={cats[0]} />;
