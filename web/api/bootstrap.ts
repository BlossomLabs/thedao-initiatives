/** Builds the API (deps, cron, Hono app) from the environment. Shared by the
 * standalone `main.ts` and the combined site server in `../server.ts`. */
import { createApp, siteLockFor } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/mod.ts";
import { prefixedKv } from "./db/prefix.ts";
import { createChain } from "./chain/mod.ts";
import { createAi } from "./services/ai.ts";
import { createEns } from "./services/ens.ts";
import { createPinata } from "./services/pinata.ts";
import { syncAll } from "./services/safe-api.ts";
import { toChecksum } from "./chain/address.ts";
import { BADGE_CONTRACT, CURATOR_ADDRESSES } from "./config.ts";
import type { Deps } from "./middleware/context.ts";

export async function createServer() {
  const config = loadConfig(Deno.env.toObject());
  const now = () => Date.now() / 1000;
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

  // Config addresses are load-bearing (role tags, admin sessions): a typo'd
  // address must stop the app, not silently grant or deny roles.
  for (const a of [...CURATOR_ADDRESSES, ...config.adminAddresses, BADGE_CONTRACT]) {
    if (toChecksum(a) !== a) throw new Error(`config address not checksummed: ${a}`);
  }
  if (!config.safeApiKey) {
    log(
      "WARNING: SAFE_API_KEY is not set; the Safe Transaction Service allows only 5,000 requests/month unauthenticated",
    );
  }

  // DB_PREFIX namespaces the keys so deployments can share one KV database.
  const kv = prefixedKv(await Deno.openKv(config.kvPath), config.dbPrefix);
  if (config.dbPrefix) log(`kv keys namespaced under DB_PREFIX=${JSON.stringify(config.dbPrefix)}`);
  const db = createDb(kv, now);
  const chain = createChain({ endpoints: config.rpcEndpoints, now });
  const deps: Deps = {
    db,
    chain,
    config,
    fetch,
    now,
    ai: createAi(config, fetch),
    ens: createEns(fetch, now),
    pinata: createPinata(config, fetch),
    log,
  };

  // Donation discovery: one authenticated Safe API request per Safe, on a
  // schedule. Page reads never call Safe.
  Deno.cron("sync-donations", config.safeSyncCron, async () => {
    try {
      const n = await syncAll(deps);
      log(`safe sync: ${n} Safe(s) checked`);
    } catch (e) {
      log(`safe sync failed: ${String(e)}`);
    }
  });

  const lock = siteLockFor(deps);
  const app = createApp(deps, lock);
  chain.state().then((s) => log(s.detail)).catch(() => {});
  if (lock.enabled) log("site lock is ON (SITE_USERNAME/SITE_PASSWORD set)");
  return { app, lock, config, deps };
}
