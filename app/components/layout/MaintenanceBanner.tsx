import { Wrench } from "lucide-react";
import { useSiteSettings } from "~/hooks/use-site-settings";

/** Site-wide notice while an admin has paused writes (services/maintenance.ts). */
export default function MaintenanceBanner() {
  const { data } = useSiteSettings();
  const m = data?.maintenance;
  if (!m?.on) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2.5 border-b border-amber-300/30 bg-amber-400/15 px-4 py-2.5 text-center text-[13.5px] text-amber-100"
    >
      <Wrench className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <b className="font-semibold">Maintenance in progress{m.note ? `: ${m.note}` : ""}.</b>{" "}
        You can browse; posting, editing and donating are paused.
      </span>
    </div>
  );
}
