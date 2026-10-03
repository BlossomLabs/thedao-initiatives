import { Link, useLocation } from "react-router";
import { categoryBoardUrl } from "~/lib/board-links";
import { categoryOf, iconOf } from "~/lib/categories";
import { cn } from "~/lib/utils";

type Common = {
  slug: string;
  /** 20px, for list rows. */
  sm?: boolean;
  className?: string;
};

const vars = (slug: string) => {
  const c = categoryOf(slug)!;
  return { "--tag": c.base, "--tag-text": c.darkText } as React.CSSProperties;
};

function Body({ slug }: { slug: string }) {
  const c = categoryOf(slug)!;
  const Icon = iconOf(c.icon);
  return (
    <>
      <Icon aria-hidden="true" />
      {c.label}
    </>
  );
}

const cls = ({ sm, className }: Common) => cn("cat-tag", sm && "cat-sm", className);

/** A category as a static tag with its full name (admin); unknown slugs render nothing. */
export function CategoryTag(p: Common) {
  if (!categoryOf(p.slug)) return null;
  return (
    <span className={cls(p)} style={vars(p.slug)}>
      <Body slug={p.slug} />
    </span>
  );
}

/** A category that links to the board filtered by it (initiative pages). */
export function CategoryLink(p: Common & { onClick?: (e: React.MouseEvent) => void }) {
  const location = useLocation();
  if (!categoryOf(p.slug)) return null;
  const label = categoryOf(p.slug)!.label;
  return (
    <Link
      to={categoryBoardUrl(location.pathname === "/" ? location.search : "", p.slug)}
      preventScrollReset
      className={cls(p)}
      style={vars(p.slug)}
      title={`Show ${label} initiatives`}
      onClick={p.onClick}
    >
      <Body slug={p.slug} />
    </Link>
  );
}
