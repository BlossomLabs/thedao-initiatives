/// <reference lib="deno.ns" />
/** Deno Deploy entrypoint: Hono serves both the API and the built website. */
import { createServer } from "./api/bootstrap.ts";
import { refreshDailyCache } from "./api/services/daily-cache.ts";
import { scanDonations } from "./api/services/donation-scan.ts";
import { withDataset } from "./api/db/dataset.ts";
import { retryDonationMatches } from "./api/services/donation-matching.ts";

const { app, config, deps } = await createServer({
  root: new URL("./build/client", import.meta.url).pathname,
  // Mirrors app/data/site.ts (which is Vite-only code).
  siteUrl: (Deno.env.get("VITE_SITE_URL") ?? "").replace(/\/+$/, "") ||
    "https://initiatives.thedao.fund",
});

// Register at module scope so Deploy discovers the job. Branch timelines skip the work.
Deno.cron("refresh-public-cache-daily", "0 3 * * *", async () => {
  await refreshDailyCache(deps, Deno.env.get("DENO_TIMELINE"));
});

// Logs mode: keep the shared cursor within the ~1 day of logs public RPCs serve,
// on quiet days too. Production only, and never while the site is paused.
Deno.cron("scan-donation-logs", "*/5 * * * *", async () => {
  if (config.donationDiscovery !== "logs") return;
  if (Deno.env.get("DENO_TIMELINE") !== "production") return;
  await withDataset(deps.db.kv, async () => {
    if (await deps.maintenance.on()) return;
    const { touched } = await scanDonations(deps);
    for (const id of touched) await retryDonationMatches(deps.db, deps.chain, id);
  });
});

// Pass Deno's connection metadata through for client IP attribution.
Deno.serve({ port: config.port }, (req, info) => app.fetch(req, info));
