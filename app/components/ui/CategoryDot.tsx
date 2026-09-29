import { categoryOf } from "~/lib/categories";
import { cn } from "~/lib/utils";

/** The two rings every dot carries, a dark one inside and a white one outside:
 * every colour gets the same edge, so light ones (lime, yellow) read the same
 * size and height as dark ones. Drawn as shadows, so the dot stays 8px. */
export const DOT_RING = "shadow-[inset_0_0_0_1px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.9)]";

/** A category's colour as an 8px dot; unknown slugs render nothing. */
export default function CategoryDot({ slug, className }: { slug: string; className?: string }) {
  const c = categoryOf(slug);
  if (!c) return null;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 flex-none rounded-full", DOT_RING, className)}
      style={{ background: c.base }}
    />
  );
}
