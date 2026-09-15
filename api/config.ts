/**
 * Central configuration: chain constants (copied from the Python MVP's
 * config.py, all verified 2026-07 against Etherscan/CoinGecko) plus
 * environment. `loadConfig(env)` is pure so tests can build their own.
 */

export const CHAIN_ID = 1; // Ethereum mainnet only

/** symbol -> [contract address, decimals] */
export const TOKENS: Record<string, [string, number]> = {
  USDC: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6],
  USDT: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", 6],
  DAI: ["0x6B175474E89094C44Da98b954EedeAC495271d0F", 18],
  USDS: ["0xdC035D45d973E3EC169d2276DDab16f1e407384F", 18],
  crvUSD: ["0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E", 18],
  BOLD: ["0x6440f144b7e50D6a8439336510312d2F54beB01D", 18],
  fxUSD: ["0x085780639CC2cACd35E474e71f4d000e2405d8f6", 18],
  // non-USD stables: priced by the Chainlink feeds below, never assumed 1:1
  EURC: ["0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", 6],
  ZCHF: ["0xB58E61C3098d85632Df34EecfB899A1Ed80921cB", 18],
};

export const NATIVE_ETH = true;
export const MIN_ETH_DONATION = 0.0005;

/** Chainlink price feeds (mainnet, all 8 decimals). */
export const CHAINLINK_FEEDS: Record<string, string> = {
  ETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // ETH/USD
  EURC: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1", // EUR/USD
  ZCHF: "0x449d117117838fFA61263B61dA6301AA2a88B13A", // CHF/USD
};

export const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://cloudflare-eth.com",
  "https://eth.drpc.org",
];

/** Per signed-in wallet, not per IP: a room on one Wi-Fi is many proposers (Griff, 2026-09-15). */
export const SUBMISSIONS_PER_HOUR_PER_WALLET = 5;
export const REVISIONS_PER_HOUR_PER_ADDRESS = 20;
/** Backer logos pinned before a submission (POST /api/uploads/logo). */
export const LOGO_UPLOADS_PER_HOUR_PER_ADDRESS = 12;
export const LOGIN_ATTEMPTS_PER_MINUTE_PER_IP = 5;
export const SUPPORT_MESSAGES_PER_HOUR_PER_IP = 5;
export const LOGIN_ATTEMPTS_PER_MINUTE_GLOBAL = 60;

// ---------------------------------------------------------- community roles
/** ETHSecurity badge (ERC-721). balanceOf > 0 grants the EXPERT tag. */
export const BADGE_CONTRACT = "0xf67C0aDe41c607EfeBf198F9D6065Ab1ec5aD4cd";

export const CURATOR_ADDRESSES = [
  "0x809FA673fe2ab515FaA168259cB14E2BeDeBF68e",
  "0x1DBA1131000664b884A1Ba238464159892252D3a",
  "0xB6647e02AE6Dd74137cB80b1C24333852E4AF890",
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "0x519d04B37bfff9667F03eA83d3346D6D85301ccb",
  "0xd161F7FA342DCefEafDEb0827B83a400F57ad0a4",
  "0xe9Fa0c8B5d7F79DeC36D3F448B1Ac4cEdedE4e69",
];

export const DEFAULT_ADMIN_ADDRESSES = [
  "0x839395e20bbB182fa440d08F850E6c7A8f6F0780", // griff.eth
];

export const MIN_VOTE_DONATION_USD = 20;
export const COMMENT_BODY_MAX = 2000;

/** A donation is credited only once its tx is this many blocks deep. */
export const MIN_CONFIRMATIONS = 3;

// ------------------------------------------------------------ Safe-per-RFP
export const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
export const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
export const SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
export const SAFE_THRESHOLD = 3;
export const SAFE_OWNER_COUNT = 5;
/** SafeProxyFactory.proxyCreationCode() of SAFE_PROXY_FACTORY (v1.4.1), read
 * from mainnet 2026-09-15: lets the server predict a deploy's CREATE2 address. */
export const SAFE_PROXY_CREATION_CODE =
  "0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";

export const SAFE_TX_SERVICE_BASE = "https://api.safe.global/tx-service/eth/api/v1";

// ------------------------------------------------------------ limits
export const MAX_TITLE = 140;
export const MAX_SUMMARY = 4000;
export const MAX_FUNDERS = 4000;
export const MAX_DETAILS = 20000;
/** Backer logo (admin pledges and the pre-submit upload). */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const AI_QUERY_MAX_CHARS = 300;
export const AI_DAILY_CALL_CAP = 500;
export const SESSION_TTL_SECS = 7 * 86400;
export const ADMIN_SESSION_TTL_SECS = 12 * 3600;
export const NONCE_TTL_SECS = 300;
export const SIWE_CLOCK_SKEW_SECS = 300;

export interface Config {
  rpcEndpoints: string[];
  webOrigins: string[]; // allowed browser origins (CORS + SIWE uri)
  siweDomains: string[]; // allowed SIWE `domain` values
  /** Hostname suffixes whose own origin is accepted without listing (see lib/origin.ts). */
  selfHostSuffixes: string[];
  adminAddresses: string[];
  operationalSigners: string[];
  safeApiKey: string;
  safeSyncCron: string;
  /** Alchemy app key: an extra mainnet RPC ahead of the public fallbacks. */
  alchemyApiKey: string;
  pinataJwt: string;
  pinataGateway: string;
  /** Where the support widget's messages are forwarded; empty = widget disabled (503). */
  supportUrl: string;
  aiSearchApiKey: string;
  aiSearchBaseUrl: string;
  aiSearchModel: string;
  aiSearchMaxTokens: number;
  /** OpenAI-style reasoning_effort sent with every chat call; "default" omits the field. */
  aiSearchReasoningEffort: string;
  onrampProvider: string;
  onrampApiKey: string;
  walletConnectProjectId: string;
  siteUsername: string;
  sitePassword: string;
  trustProxy: boolean;
  port: number;
  kvPath: string | undefined;
  /** First key part every KV key is stored under; empty = bare keys. */
  dbPrefix: string;
}

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function flag(v: string | undefined): boolean {
  return ["1", "true", "yes"].includes((v ?? "").trim().toLowerCase());
}

const bareOrigin = (o: string): string => {
  try {
    return new URL(o).origin;
  } catch {
    return o;
  }
};

/**
 * Browser origins allowed to call the API: WEB_ORIGIN when set (a list, for
 * local dev or a second domain), else the public site URL the client was
 * built with, else the Vite dev server. Entries are reduced to bare origins:
 * the browser's Origin header has no trailing slash or path, and the guard
 * compares exact strings (a "https://host/" entry once matched nothing).
 */
export function webOriginsFrom(env: Record<string, string | undefined>): string[] {
  const listed = list(env.WEB_ORIGIN).map(bareOrigin);
  if (listed.length) return listed;
  const site = (env.VITE_SITE_URL ?? "").trim();
  return [site ? bareOrigin(site) : "http://localhost:5173"];
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rpcOverride = (env.RPC_URL ?? "").trim();
  const alchemyApiKey = (env.ALCHEMY_API_KEY ?? "").trim();
  const webOrigins = webOriginsFrom(env);
  let siweDomains = list(env.SIWE_DOMAINS);
  if (siweDomains.length === 0) {
    siweDomains = webOrigins.map((o) => {
      try {
        return new URL(o).host;
      } catch {
        return o;
      }
    });
  }
  return {
    rpcEndpoints: [
      ...(rpcOverride ? [rpcOverride] : []),
      ...(alchemyApiKey ? [`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`] : []),
      ...DEFAULT_RPC_ENDPOINTS,
    ],
    webOrigins,
    siweDomains,
    selfHostSuffixes: list(env.SELF_HOST_SUFFIXES).length
      ? list(env.SELF_HOST_SUFFIXES)
      : [".deno.net", ".deno.dev"],
    adminAddresses: list(env.ADMIN_ADDRESSES).length
      ? list(env.ADMIN_ADDRESSES)
      : [...DEFAULT_ADMIN_ADDRESSES],
    operationalSigners: list(env.OPERATIONAL_SIGNERS),
    safeApiKey: (env.SAFE_API_KEY ?? "").trim(),
    safeSyncCron: (env.SAFE_SYNC_CRON ?? "").trim() || "*/10 * * * *",
    alchemyApiKey,
    pinataJwt: (env.PINATA_JWT ?? "").trim(),
    pinataGateway: (env.PINATA_GATEWAY ?? "").trim() || "ipfs.blossom.software",
    supportUrl: (env.SUPPORT_URL ?? "").trim(),
    aiSearchApiKey: (env.AI_SEARCH_API_KEY ?? "").trim(),
    aiSearchBaseUrl: ((env.AI_SEARCH_BASE_URL ?? "").trim() || "https://api.deepseek.com")
      .replace(/\/+$/, ""),
    aiSearchModel: (env.AI_SEARCH_MODEL ?? "").trim() || "deepseek-chat",
    // Reasoning models spend this budget on hidden thinking before the JSON,
    // so a tight cap truncates the answer mid-object and fails the parse.
    aiSearchMaxTokens: Number(env.AI_SEARCH_MAX_TOKENS ?? "") || 2000,
    aiSearchReasoningEffort: (env.AI_SEARCH_REASONING_EFFORT ?? "").trim() || "none",
    onrampProvider: ((env.ONRAMP_PROVIDER ?? "").trim() || "transak").toLowerCase(),
    onrampApiKey: (env.ONRAMP_API_KEY ?? "").trim(),
    walletConnectProjectId: (env.WALLETCONNECT_PROJECT_ID ?? "").trim(),
    siteUsername: (env.SITE_USERNAME ?? "").trim(),
    sitePassword: (env.SITE_PASSWORD ?? "").trim(),
    trustProxy: flag(env.TRUST_PROXY),
    port: Number(env.PORT ?? "8000") || 8000,
    kvPath: (env.KV_PATH ?? "").trim() || undefined,
    dbPrefix: (env.DB_PREFIX ?? "").trim(),
  };
}
