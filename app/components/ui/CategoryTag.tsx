import { Check } from "lucide-react";
import { Link } from "react-router";
import { categoryOf, iconOf } from "~/lib/categories";
import { cn } from "~/lib/utils";

type Common = {
  slug: string;
  /** 20px, for list rows. */
  sm?: boolean;
  /** Icon only, with the label as tooltip and accessible name. */
  iconOnly?: boolean;
  className?: string;
  /** Suffix after the label, such as a live count. */
  after?: React.ReactNode;
};

const vars = (slug: string) => {
  const c = categoryOf(slug)!;
  return { "--tag": c.base, "--tag-text": c.darkText } as React.CSSProperties;
};

function Body({ slug, iconOnly, selected, after }: Common & { selected?: boolean }) {
  const c = categoryOf(slug)!;
  const Icon = selected ? Check : iconOf(c.icon);
  return (
    <>
      <Icon aria-hidden="true" />
      {!iconOnly && c.label}
      {!iconOnly && after}
    </>
  );
}

const cls = ({ sm, iconOnly, className }: Common, extra?: string) =>
  cn("cat-tag", sm && "cat-sm", iconOnly && "cat-icon cat-sm", extra, className);

/** A category as a static tag; unknown slugs render nothing. */
export function CategoryTag(p: Common) {
  if (!categoryOf(p.slug)) return null;
  const label = categoryOf(p.slug)!.label;
  return (
    <span
      className={cls(p)}
      style={vars(p.slug)}
      title={p.iconOnly ? label : undefined}
      aria-label={p.iconOnly ? label : undefined}
      role={p.iconOnly ? "img" : undefined}
    >
      <Body {...p} />
    </span>
  );
}

/** A category that links to the board filtered by it. */
export function CategoryLink(p: Common & { onClick?: (e: React.MouseEvent) => void }) {
  if (!categoryOf(p.slug)) return null;
  const label = categoryOf(p.slug)!.label;
  return (
    <Link
      to={`/?cat=${p.slug}`}
      className={cls(p)}
      style={vars(p.slug)}
      title={p.iconOnly ? label : `Show ${label} initiatives`}
      aria-label={p.iconOnly ? label : undefined}
      onClick={p.onClick}
    >
      <Body {...p} />
    </Link>
  );
}

/** A toggle chip (filters, pickers): a real button with aria-pressed. */
export function CategoryChip(
  p: Common & {
    selected: boolean;
    dim?: boolean;
    disabled?: boolean;
    onToggle: () => void;
    title?: string;
  },
) {
  if (!categoryOf(p.slug)) return null;
  return (
    <button
      type="button"
      className={cls(p, cn(p.selected && "cat-on", p.dim && !p.selected && "cat-dim"))}
      style={vars(p.slug)}
      aria-pressed={p.selected}
      disabled={p.disabled}
      title={p.title}
      onClick={p.onToggle}
    >
      <Body {...p} />
    </button>
  );
}
