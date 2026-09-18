/** Daily fallback for quiet production days. Visitor refreshes remain the
 * normal path; both paths share freshness checks and per-Safe KV leases. */
import type { Funding } from "./funding.ts";
import { refreshLedgers } from "./ledger.ts";
import type { SafeApiDeps } from "./safe-api.ts";
import type { Maintenance } from "./maintenance.ts";

interface DailyCacheDeps extends SafeApiDeps {
  funding: Funding;
  maintenance: Maintenance;
}

export async function refreshDailyCache(
  deps: DailyCacheDeps,
  timeline: string | undefined,
): Promise<void> {
  // Check the runtime timeline, not the git branch name. Preview, branch,
  // local, and missing/unknown environments must do no scheduled work.
  if (timeline !== "production") return;
  // A paused site is being backed up or moved: no background writes.
  if (await deps.maintenance.on()) return;

  const rfps = (await deps.db.initiatives.list(["approved"])).filter((rfp) => rfp.safeAddress);
  await refreshLedgers(deps, rfps);
  // Sequential balance reads reuse price feeds and bound upstream concurrency.
  // `true` requests revalidation; it does not bypass freshness or active leases.
  for (const safe of new Set(rfps.map((rfp) => rfp.safeAddress.toLowerCase()))) {
    await deps.funding.balances(safe, true);
  }
  deps.log?.(`daily cache refresh: ${rfps.length} approved Safe(s) checked`);
}
