import { cn } from "~/lib/utils";

/**
 * A backer's round logo, or the same-sized silhouette when none was uploaded.
 * Shared by the board card's "Backed by" strip and the initiative's Backers list.
 */
export default function BackerLogo(
  { logoUrl, company, className }: { logoUrl: string; company: string; className?: string },
) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={company}
        title={company}
        className={cn(
          "size-10 rounded-full border border-white/15 bg-white object-contain p-1.5",
          className,
        )}
      />
    );
  }
  return (
    <span
      title={company}
      className={cn(
        "flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/[.06] text-white/40",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    </span>
  );
}
