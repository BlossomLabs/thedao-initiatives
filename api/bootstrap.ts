/** Builds the Hono app from the environment, optionally with the built website. */
import { createApp, siteLockFor } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/mod.ts";
import { prefixedKv } from "./db/prefix.ts";
import { createChain } from "./chain/mod.ts";
import { createAi } from "./services/ai.ts";
import { createEns, onchainEns } from "./services/ens.ts";
import { createPinata } from "./services/pinata.ts";
import { warmImageWorker } from "./lib/image.ts";
import { createMaintenance } from "./services/maintenance.ts";
import { createFunding } from "./services/funding.ts";
import { toChecksum } from "./chain/address.ts";
import { ALWAYS_ENFORCED_RATE_LIMITS, BADGE_CONTRACT, CURATOR_ADDRESSES } from "./config.ts";
import type { Deps } from "./middleware/context.ts";
import { createAdmins } from "./services/admins.ts";
import {
  createStateSource,
  createVoteChain,
  type StateSourceMemo,
  stateSourceMemo,
} from "./services/vote-chain.ts";
import { reviewTokenIds } from "./chain/reviewer.ts";
import { MAINNET_CHAIN_ID, type VoteManifest } from "../shared/vote/manifest.ts";
import { refreshVoteManifest } from "./services/vote-refresh.ts";
import { slugsByAccount } from "../shared/vote/round-from-chain.ts";
import {
  createActiveVote,
  migrateVoteSettings,
  type VoteRoundSetting,
  voteSettingKey,
} from "./services/vote-active.ts";
import { createStaticSite, type SiteOptions } from "./site.ts";

/** Structured events (audit trail, rate limit breaches) are emitted as one JSON
 * object per line for the OpenTelemetry collector; everything else is timestamped text. */
export function formatLogLine(msg: string, at = new Date()): string {
  return msg.startsWith('{"') ? msg : `[${at.toISOString()}] ${msg}`;
}

export async function createServer(siteOptions?: SiteOptions) {
  const config = loadConfig(Deno.env.toObject());
  const now = () => Date.now() / 1000;
  const log = (msg: string) => console.log(formatLogLine(msg));

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
  const db = createDb(kv, now, {
    mode: config.rateLimitMode,
    log,
    alwaysEnforce: ALWAYS_ENFORCED_RATE_LIMITS,
  });
  if (config.rateLimitMode === "off") {
    log("WARNING: RATE_LIMIT_MODE=off; no rate limit is counted or enforced");
  } else if (config.rateLimitMode === "observe") {
    log(
      `RATE_LIMIT_MODE=observe; breaches are logged, only ${
        ALWAYS_ENFORCED_RATE_LIMITS.join(" ")
      } refuse`,
    );
  }
  const chain = createChain({ endpoints: config.rpcEndpoints, now });
  const voteRpcUrl = (m: VoteManifest) =>
    m.chainId === MAINNET_CHAIN_ID ? config.rpcEndpoints[0] : config.sepoliaRpcUrl;
  const relayerKey = /^0x[0-9a-fA-F]{64}$/.test(config.voteRelayerKey)
    ? config.voteRelayerKey as `0x${string}`
    : null;
  const stateMemos = new Map<string, StateSourceMemo>();
  /** One per round configuration, shared by its pins (each new head block builds a new
   * VoteRound): logs, finalized prefixes and searches outlive a pin. */
  const memoFor = (m: VoteManifest) => {
    const key = `${m.kind}:${m.chainId}:${m.contract}:${m.configRevision ?? "legacy"}:${
      m.configAnchor?.hash ?? ""
    }`;
    let memo = stateMemos.get(key);
    if (!memo) {
      if (stateMemos.size >= 4) stateMemos.delete(stateMemos.keys().next().value!);
      stateMemos.set(key, memo = stateSourceMemo());
    }
    return memo;
  };
  const stateSourceFor = (m: VoteManifest) =>
    createStateSource(m, voteRpcUrl(m), undefined, memoFor(m));
  await migrateVoteSettings(db);
  const activeVote = (environment: "production" | "test") =>
    createActiveVote({
      environment,
      read: () => db.meta.get<VoteRoundSetting>(voteSettingKey(environment)),
      refresh: async (m) => {
        const next = await refreshVoteManifest(m, voteRpcUrl(m), {
          finalAnchors: memoFor(m).pins,
          slugOf: async () =>
            slugsByAccount(
              await db.initiatives.list(["approved", "archived", "pending", "rejected"]),
            ),
        });
        if (
          next.configRevision !== m.configRevision ||
          next.configAnchor?.hash !== m.configAnchor?.hash
        ) {
          await db.meta.update<VoteRoundSetting>(voteSettingKey(environment), (cur) => {
            const set = cur?.round ?? cur?.test;
            if (
              !set || set.manifest.chainId !== m.chainId ||
              set.manifest.contract.toLowerCase() !== m.contract.toLowerCase()
            ) return cur!;
            // Do not overwrite a concurrent refresh. A lower revision can be canonical after a reorg.
            if (
              set.manifest.configRevision !== m.configRevision ||
              set.manifest.configAnchor?.hash !== m.configAnchor?.hash
            ) return cur!;
            return { ...cur, round: { ...set, manifest: next } };
          });
        }
        return next;
      },
      build: (m) => ({
        manifest: m,
        chain: createVoteChain(
          m,
          voteRpcUrl(m),
          relayerKey,
          undefined,
          (a) => reviewTokenIds(chain.rpc, a, fetch),
          memoFor(m),
        ),
        // Past blocks need an archive node: the round's RPC (RPC_URL / SEPOLIA_RPC_URL) must be one.
        source: stateSourceFor(m),
      }),
    });
  const deps: Deps = {
    db,
    chain,
    config,
    fetch,
    now,
    funding: createFunding({ db, chain, now, log }),
    ai: createAi(config, fetch, { log }),
    admins: createAdmins(db, config, now),
    maintenance: createMaintenance(db, now),
    ens: createEns(fetch, now, { onchain: onchainEns(config.rpcEndpoints, fetch), log }),
    pinata: createPinata(config, fetch),
    log,
    // Off until an admin sets a round (Admin → Vote, by its contract address).
    voteEnvironment: "production",
    voteRound: activeVote("production"),
    testVoteRound: activeVote("test"),
  };
  // Load the image decoder before the first upload asks for it.
  if (deps.pinata.enabled) warmImageWorker();
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
