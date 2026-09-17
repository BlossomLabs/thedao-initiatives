/** Builds the Hono app from the environment, optionally with the built website. */
import { createApp, siteLockFor } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/mod.ts";
import { prefixedKv } from "./db/prefix.ts";
import { createChain } from "./chain/mod.ts";
import { createAi } from "./services/ai.ts";
import { createEns, onchainEns } from "./services/ens.ts";
import { createPinata } from "./services/pinata.ts";
import { createFunding } from "./services/funding.ts";
import { toChecksum } from "./chain/address.ts";
import { BADGE_CONTRACT, CURATOR_ADDRESSES } from "./config.ts";
import type { Deps } from "./middleware/context.ts";
import { createAdmins } from "./services/admins.ts";
import { createStaticSite, type SiteOptions } from "./site.ts";

export async function createServer(siteOptions?: SiteOptions) {
  const config = loadConfig(Deno.env.toObject());
  const now = () => Date.now() / 1000;
  const log = (msg: string) =>
    console.log(
      msg.startsWith('{"securityAudit":true,') ? msg : `[${new Date().toISOString()}] ${msg}`,
    );

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
  const db = createDb(kv, now, { rateLimitsDisabled: config.rateLimitsDisabled });
  if (config.rateLimitsDisabled) {
    log("WARNING: DISABLE_RATE_LIMITS is set; no rate limit is enforced");
  }
  const chain = createChain({ endpoints: config.rpcEndpoints, now });
  const deps: Deps = {
    db,
    chain,
    config,
    fetch,
    now,
    funding: createFunding({ db, chain, now, log }),
    ai: createAi(config, fetch),
    admins: createAdmins(db, config, now),
    ens: createEns(fetch, now, { onchain: onchainEns(config.rpcEndpoints, fetch), log }),
    pinata: createPinata(config, fetch),
    log,
  };
  const lock = siteLockFor(deps);
  const site = siteOptions
    ? await createStaticSite(
      {
        ...siteOptions,
        connectOrigins: config.cspConnectOrigins,
        rewriteOrigins: config.webOrigins,
        selfHostSuffixes: config.selfHostSuffixes,
      },
      config.cspEnforce,
      log,
    )
    : undefined;
  const app = createApp(deps, lock, site);
  if (lock.enabled) log("site lock is ON (SITE_USERNAME/SITE_PASSWORD set)");
  return { app, lock, config, deps };
}
