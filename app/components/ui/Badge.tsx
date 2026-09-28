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
        !inline && "absolute top-4 right-[18px]",
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
  ADMIN: ["Admin", "text-dao-amber border-[rgba(255,180,50,.32)] bg-[rgba(255,180,50,.12)]"],
  PROPOSER: ["Proposer", "text-dao-sky border-[rgba(90,200,250,.4)] bg-[rgba(90,200,250,.12)]"],
  CURATOR: ["Curator", "text-dao-green border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.12)]"],
  EXPERT: ["Badge holder", "text-dao-red border-[rgba(255,59,56,.4)] bg-[rgba(255,59,56,.12)]"],
  DONOR: ["Donor", "text-[#c4a6ff] border-[rgba(160,108,255,.4)] bg-[rgba(160,108,255,.14)]"],
};

/** Role chips, priority order, at most two shown. */
export function RoleTags({ roles }: { roles: string[] }) {
  const shown = ["ADMIN", "PROPOSER", "CURATOR", "EXPERT", "DONOR"].filter((r) => roles.includes(r))
    .slice(
      0,
      2,
    );
  return (
    <>
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

/** "ETHSecurity Badge holder": the category-tag pill shape, neutral, no icon. */
export function BadgeHolderTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-full border border-white/35 bg-white/10 px-2.5 font-inter-tight text-[12px] font-semibold text-white",
        className,
      )}
    >
      ETHSecurity Badge holder
    </span>
  );
}
