import { cn } from "~/lib/utils";
import { Loader2 } from "lucide-react";
import { Link } from "react-router";

type Variant = "default" | "primary" | "ghost" | "danger" | "discuss";

/** A compact bordered button (about 29px), smaller than `btn-sm`: the comment cards'
 * actions, and small actions beside a heading. A class string, for a <button> or a link. */
export const SMALL_BUTTON =
  "inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-white/[.16] bg-white/5 px-3.5 py-2 font-inter-tight text-[13px] font-semibold leading-none text-[#f2f6fa] transition-all duration-150 hover:border-white/[.28] hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-60";

interface Common {
  variant?: Variant;
  sm?: boolean;
  className?: string;
  children: React.ReactNode;
}

const classes = (variant: Variant, sm: boolean | undefined, className?: string) =>
  cn(
    "btn",
    variant === "primary" && "btn-primary",
    variant === "ghost" && "btn-ghost",
    variant === "danger" && "btn-danger",
    variant === "discuss" && "btn-discuss",
    sm && "btn-sm",
    className,
  );

export function Button({
  variant = "default",
  sm,
  className,
  loading,
  children,
  type = "button",
  ...rest
}: Common & React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type={type}
      className={classes(variant, sm, className)}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton(
  { variant = "default", sm, className, to, children, prefetch, ...rest }:
    & Common
    & { to: string; prefetch?: "intent" | "render" | "viewport" | "none" }
    & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">,
) {
  const cls = cn(classes(variant, sm, className), "no-underline hover:no-underline");
  if (/^https?:/.test(to)) {
    return (
      <a href={to} className={cls} target="_blank" rel="noopener" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={cls} prefetch={prefetch} {...rest}>
      {children}
    </Link>
  );
}
