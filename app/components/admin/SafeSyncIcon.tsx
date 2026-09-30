import {
  CircleCheck,
  CircleDashed,
  CircleX,
  type LucideIcon,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { SafeSyncState } from "~/lib/api-types";
import { dt } from "~/lib/format";
import { cn } from "~/lib/utils";

/** A Safe's history refreshes when someone views it; a day without a sync reads as outdated. */
export const OUTDATED_SECS = 24 * 3600;

type Kind = "none" | "never" | "ok" | "outdated" | "syncing" | "error";

/** Which of the six states a row's Safe sync is in, and what to call it. */
export function safeSyncState(
  safeAddress: string,
  sync: SafeSyncState | null,
  now = Date.now() / 1000,
): { kind: Kind; label: string } {
  if (!safeAddress) return { kind: "none", label: "No Safe" };
  if (!sync) return { kind: "never", label: "Never synced" };
  if (!sync.ok) return { kind: "error", label: `Sync error: ${sync.error || "unknown"}` };
  if (sync.updating || !sync.backfilled) {
    return { kind: "syncing", label: `Backfilling history, last run ${dt(sync.at)}` };
  }
  if (now - sync.at > OUTDATED_SECS) {
    return { kind: "outdated", label: `Outdated: last synced ${dt(sync.at)}` };
  }
  return { kind: "ok", label: `Synced ${dt(sync.at)}` };
}

const ICONS: Record<Exclude<Kind, "none">, [LucideIcon, string]> = {
  ok: [CircleCheck, "text-dao-green"],
  outdated: [TriangleAlert, "text-dao-amber"],
  syncing: [RefreshCw, "text-dao-sky"],
  error: [CircleX, "text-dao-red"],
  never: [CircleDashed, "text-white/40"],
};

/** The admin list's Safe sync cell: one icon, its meaning as the tooltip and the accessible name. */
export default function SafeSyncIcon(
  { safeAddress, sync, now }: { safeAddress: string; sync: SafeSyncState | null; now?: number },
) {
  const { kind, label } = safeSyncState(safeAddress, sync, now);
  if (kind === "none") {
    return <span className="dim" role="img" aria-label={label} title={label}>–</span>;
  }
  const [Icon, color] = ICONS[kind];
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex align-middle">
      <Icon className={cn("size-[18px]", color)} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}
