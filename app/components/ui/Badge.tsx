import { cn } from "~/lib/utils";
import type { InitiativeType } from "~/lib/api-types";

export function TypeBadge(
  { type, className, inline }: { type: InitiativeType; className?: string; inline?: boolean },
) {
  return (
    <span
      className={cn(
        "type-badge",
        type === "grant" ? "t-grant" : "t-rfp",
        // On a card: centred on the title's first line of text (24px padding + half the 20px
        // text box), its right edge on the card padding like the progress bar.
        !inline && "absolute top-[34px] right-6 -translate-y-1/2",
        className,
      )}
    >
      {type === "grant" ? "Grant" : "RFP"}
    </span>
  );
}

export function StatusChip({ status, className }: { status: string; className?: string }) {
  return <span className={cn("chip", `st-${status}`, className)}>{status}</span>;
}

export function FundedChip() {
  return <span className="chip funded-chip">FUNDED</span>;
}

const ROLE_TAGS: Record<string, [string, string]> = {
  ADMIN: ["Admin", "text-white border-white/40 bg-white/10"],
  PROPOSER: ["Proposer", "text-dao-sky border-[rgba(90,200,250,.4)] bg-[rgba(90,200,250,.12)]"],
  CURATOR: ["Curator", "text-dao-green border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.12)]"],
  DONOR: ["Donor", "text-[#c4a6ff] border-[rgba(160,108,255,.4)] bg-[rgba(160,108,255,.14)]"],
};

/** Role chips, priority order, at most two shown, after the Badge holder chip
 * (EXPERT), which is always shown. */
export function RoleTags({ roles }: { roles: string[] }) {
  const shown = ["ADMIN", "PROPOSER", "CURATOR", "DONOR"].filter((r) => roles.includes(r))
    .slice(
      0,
      2,
    );
  return (
    <>
      {roles.includes("EXPERT") && <BadgeHolderTag />}
      {shown.map((r) => (
        <span
          key={r}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-inter-tight text-[10.5px] font-bold uppercase tracking-[.06em] before:size-1.5 before:rounded-full before:bg-current before:content-['']",
            ROLE_TAGS[r][1],
          )}
        >
          {ROLE_TAGS[r][0]}
        </span>
      ))}
    </>
  );
}

export function QaChip(
  { children, tone = "state" }: { children: React.ReactNode; tone?: "state" | "ok" | "feat" },
) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-inter-tight text-[10.5px] font-bold uppercase tracking-[.06em]",
        tone === "state" && "border-white/10 bg-white/[.03] text-muted",
        tone === "ok" && "border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.12)] text-dao-green",
        tone === "feat" &&
          "border-[rgba(0,255,136,.35)] bg-[rgba(0,255,136,.1)] text-dao-bright before:size-1.5 before:rounded-full before:bg-current before:shadow-[0_0_6px_rgba(0,255,136,.9)] before:content-['']",
      )}
    >
      {children}
    </span>
  );
}

export const BADGE_HOLDER = "ETHSecurity Badge holder";

/**
 * The ETHSecurity Badge holder mark: the badge itself, a gold shield with the
 * Ethereum diamond (thedao.fund/ethsecurity-badges), flat so it reads at 14-16px
 * and stands out beside a name in any colour (the signed-in wallet button is
 * green). Labelled by default; `decorative` when words sit beside it.
 */
export function BadgeHolderMark(
  { className, decorative, onAnimationEnd }: {
    className?: string;
    decorative?: boolean;
    onAnimationEnd?: () => void;
  },
) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 flex-none", className)}
      onAnimationEnd={onAnimationEnd}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": BADGE_HOLDER })}
    >
      {!decorative && <title>{BADGE_HOLDER}</title>}
      <path
        d="M12 1.6 20.6 4.8v6.6c0 5.3-3.6 9.4-8.6 11-5-1.6-8.6-5.7-8.6-11V4.8Z"
        fill="var(--color-panel-deep)"
        stroke="#f2c14e"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M12 5.6 8 12.2 12 14.6Z" fill="#ffd978" />
      <path d="M12 5.6 16 12.2 12 14.6Z" fill="#e0a932" />
      <path d="M8 13.1 12 15.5 16 13.1 12 18.6Z" fill="#f2c14e" />
    </svg>
  );
}

/** The mark with its name, in a comment's role chips. */
export function BadgeHolderTag() {
  return (
    <span
      title={BADGE_HOLDER}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgba(255,180,50,.32)] bg-[rgba(255,180,50,.12)] py-1 pl-1.5 pr-2.5 font-inter-tight text-[10.5px] font-bold uppercase tracking-[.06em] text-dao-amber"
    >
      <BadgeHolderMark decorative className="size-3.5" />
      Badge holder
    </span>
  );
}

/** The mark spelled out, where there is room to say what it means (the wallet menu). */
export function BadgeHolderNote({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 font-inter-tight text-[12.5px] text-white/70",
        className,
      )}
    >
      <BadgeHolderMark decorative />
      {BADGE_HOLDER}
    </span>
  );
}
