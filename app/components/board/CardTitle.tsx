import { Suspense } from "react";
import { Link } from "react-router";
import { standInFocus } from "~/lib/focus-handover";
import { cn } from "~/lib/utils";
import { lazyPart } from "~/lib/lazy-part";
import { Dots, DOTS_BUTTON, dotsLabel, dotsOf } from "./DotsFace";

/** The same dots on a plain button, until (or if never) the popover code arrives. */
function DotsStandIn({ slugs, focusKey = "" }: { slugs: string[]; focusKey?: string }) {
  const cats = dotsOf(slugs);
  if (!cats.length) return null;
  return (
    <button
      type="button"
      className={DOTS_BUTTON}
      aria-label={dotsLabel(cats)}
      onPointerEnter={preloadDots}
      {...standInFocus(focusKey)}
      onFocusCapture={preloadDots}
      onClick={preloadDots}
    >
      <Dots cats={cats} />
    </button>
  );
}

// The popover and tooltip code loads after the board, not with it: the board
// calls preloadDots() once it has mounted.
const dots = lazyPart(() => import("./CategoryDots"), DotsStandIn);
export const preloadDots = dots.preload;
const CategoryDots = dots.Component;

const LINK =
  "text-white no-underline hover:text-dao-green hover:no-underline focus-visible:text-dao-green";

/**
 * The card title, led by its primary category's icon. The icon is one button
 * (a 24px target): hover or focus names every category, a click opens the
 * popover that browses by each. The title is one plain link.
 */
export default function CardTitle({
  title,
  href,
  categories,
  onPrefetch,
  className,
}: {
  title: string;
  href: string;
  categories: string[];
  onPrefetch?: () => void;
  /** List rows: a smaller title with no room kept for the type badge. */
  className?: string;
}) {
  return (
    <div
      className={cn("pr-[72px] font-inter-tight text-[16px] font-medium leading-[1.35]", className)}
    >
      {dotsOf(categories).length > 0 && (
        <Suspense fallback={<DotsStandIn slugs={categories} focusKey={href} />}>
          <CategoryDots slugs={categories} focusKey={href} />
        </Suspense>
      )}
      <Link
        to={href}
        prefetch="intent"
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        className={LINK}
      >
        {title}
      </Link>
    </div>
  );
}
