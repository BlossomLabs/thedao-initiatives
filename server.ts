/// <reference lib="deno.ns" />
/** Deno Deploy entrypoint: Hono serves both the API and the built website. */
import { createServer } from "./api/bootstrap.ts";
import { refreshDailyCache } from "./api/services/daily-cache.ts";

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

// Pass Deno's connection metadata through for client IP attribution.
Deno.serve({ port: config.port }, (req, info) => app.fetch(req, info));
