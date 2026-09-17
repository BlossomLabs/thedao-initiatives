/** Full-app harness: in-memory KV, scripted fake RPC, mockable fetch. */
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import * as config from "../config.ts";
import { createDb } from "../db/mod.ts";
import { createChain } from "../chain/mod.ts";
import { createAi } from "../services/ai.ts";
import { createEns } from "../services/ens.ts";
import { createPinata } from "../services/pinata.ts";
import { createFunding } from "../services/funding.ts";
import type { Deps } from "../middleware/context.ts";
import {
  SEL_BALANCE_OF,
  SEL_DECIMALS,
  SEL_GET_OWNERS,
  SEL_GET_THRESHOLD,
  SEL_LATEST_ROUND_DATA,
  SEL_SYMBOL,
} from "../chain/abi.ts";
import { keccakHex, utf8 } from "../chain/keccak.ts";
import { predictSafeAddress } from "../chain/safe.ts";
import { chainlinkRound, SIGNERS, word } from "./helpers.ts";
import { createAdmins } from "../services/admins.ts";

export const ORIGIN = "http://localhost:5173";
export const CURATOR = config.CURATOR_ADDRESSES[0];
export const ADMIN = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A"; // wallet("0x11..11")
export const PLAIN = "0x1563915e194D8CfBA1943570603F7606A3115508"; // wallet("0x22..22")
export const SAFE_ADDR = "0xD5Cf05f24727C83976652E3586c0e26DD39884e9";

/** Realistic Deno socket metadata; tests must not depend on an unknown-IP fallback. */
export function testConnection(hostname = "203.0.113.42"): Deno.ServeHandlerInfo<Deno.NetAddr> {
  return { remoteAddr: { transport: "tcp", hostname, port: 43210 }, completed: Promise.resolve() };
}

function abiString(s: string): string {
  const hex = Array.from(utf8(s)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return "0x" + word(32) + word(s.length) + hex.padEnd(64, "0");
}

export interface ChainScript {
  head: number;
  receipts: Record<string, unknown>;
  txs: Record<string, unknown>;
  badgeHolders: Set<string>;
  ethUsd: number;
  brokenTokens: Set<string>;
  brokenFeeds: Set<string>;
  /** `"SYM:0xsafe"` (lowercase address) -> raw balance. */
  tokenBalances: Record<string, bigint>;
  /** lowercase address -> wei. */
  ethBalances: Record<string, bigint>;
  /** Every RPC method called, in order. */
  calls: string[];
  /** lowercase address -> bytecode, for eth_getCode ("0x" when absent). */
  code: Record<string, string>;
  /** Every Safe answers getThreshold() with the wrong number. */
  brokenSafe: boolean;
}

export function scriptedRpc(script: ChainScript, now: () => number) {
  const tokensByAddr = new Map(
    Object.entries(config.TOKENS).map(([sym, [a, d]]) => [a.toLowerCase(), { sym, d }]),
  );
  const feeds = new Map(
    Object.entries(config.CHAINLINK_FEEDS).map(([sym, a]) => [a.toLowerCase(), sym]),
  );
  const encodedOwners = "0x" + word(32) + word(SIGNERS.length) +
    SIGNERS.map((a) => "0".repeat(24) + a.slice(2).toLowerCase()).join("");
  const fbSlot = keccakHex(utf8("fallback_manager.handler.address"));
  return (method: string, params: unknown[]): Promise<unknown> => {
    script.calls.push(method);
    const p0 = params[0] as { to?: string; data?: string } | string;
    switch (method) {
      case "eth_getBalance":
        return Promise.resolve(
          "0x" + (script.ethBalances[String(p0).toLowerCase()] ?? 0n).toString(16),
        );
      case "eth_blockNumber":
        return Promise.resolve("0x" + script.head.toString(16));
      case "eth_getCode":
        return Promise.resolve(script.code[String(p0).toLowerCase()] ?? "0x");
      case "eth_getTransactionReceipt":
        return Promise.resolve(script.receipts[String(p0).toLowerCase()] ?? null);
      case "eth_getTransactionByHash":
        return Promise.resolve(script.txs[String(p0).toLowerCase()] ?? null);
      case "eth_getStorageAt": {
        const slot = String(params[1]);
        return Promise.resolve(
          slot === fbSlot
            ? "0x" + "0".repeat(24) + config.SAFE_FALLBACK_HANDLER.slice(2).toLowerCase()
            : "0x" + "0".repeat(24) + config.SAFE_SINGLETON.slice(2).toLowerCase(),
        );
      }
      case "eth_call": {
        const { to = "", data = "" } = p0 as { to?: string; data?: string };
        const sel = data.slice(0, 10);
        const tok = tokensByAddr.get(to.toLowerCase());
        if (tok) {
          if (script.brokenTokens.has(tok.sym)) throw new Error("rpc down");
          if (sel === SEL_DECIMALS) return Promise.resolve("0x" + word(tok.d));
          if (sel === SEL_SYMBOL) return Promise.resolve(abiString(tok.sym));
          if (sel === SEL_BALANCE_OF) {
            const holder = "0x" + data.slice(-40).toLowerCase();
            return Promise.resolve("0x" + word(script.tokenBalances[`${tok.sym}:${holder}`] ?? 0n));
          }
        }
        const feed = feeds.get(to.toLowerCase());
        if (feed && sel === SEL_LATEST_ROUND_DATA) {
          if (script.brokenFeeds.has(feed)) throw new Error("feed rpc down");
          const rate = feed === "ETH" ? script.ethUsd : feed === "EURC" ? 1.143 : 1.2413;
          return Promise.resolve(
            chainlinkRound(Math.round(rate * 1e8), Math.floor(now())),
          );
        }
        if (
          to.toLowerCase() === config.BADGE_CONTRACT.toLowerCase() &&
          sel === SEL_BALANCE_OF
        ) {
          const addr = "0x" + data.slice(-40);
          return Promise.resolve(
            "0x" + word(script.badgeHolders.has(addr.toLowerCase()) ? 1 : 0),
          );
        }
        if (sel === SEL_GET_THRESHOLD) {
          return Promise.resolve("0x" + word(script.brokenSafe ? 1 : config.SAFE_THRESHOLD));
        }
        if (sel === SEL_GET_OWNERS) return Promise.resolve(encodedOwners);
        return Promise.resolve("0x");
      }
    }
    throw new Error(`unexpected rpc ${method}`);
  };
}

export type FetchLog = { url: string; init?: RequestInit }[];

export interface Harness {
  app: ReturnType<typeof createApp>;
  deps: Deps;
  db: ReturnType<typeof createDb>;
  kv: Deno.Kv;
  script: ChainScript;
  fetchLog: FetchLog;
  clock: { now: number };
  /** Mint a session directly (no signing) and return the bearer token. */
  mint(address: string, isAdmin?: boolean): Promise<string>;
  /** Fetch against the app with same-origin headers. */
  req(
    path: string,
    init?: RequestInit & { token?: string; json?: unknown },
  ): Promise<Response>;
  close(): void;
}

/** Put the initiative's Safe on the fake chain and bind it, as the deploy panel would. */
export async function deploySafe(h: Harness, admin: string, id: string): Promise<string> {
  const rfp = (await h.db.rfps.get(id))!;
  const address = predictSafeAddress(SIGNERS, rfp.safeDeploymentKey ?? rfp.slug);
  h.script.code[address.toLowerCase()] = "0x6080";
  const res = await h.req(`/api/admin/initiatives/${id}/safe-confirm`, {
    method: "POST",
    token: admin,
    json: {},
  });
  if (res.status !== 200) throw new Error(`safe-confirm ${res.status}: ${await res.text()}`);
  return address;
}

export interface HarnessOptions {
  env?: Record<string, string>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response> | Response;
}

export async function harness(opts: HarnessOptions = {}): Promise<Harness> {
  const clock = { now: 1_800_000_000 };
  const now = () => clock.now;
  const cfg = loadConfig({
    WEB_ORIGIN: ORIGIN,
    ADMIN_ADDRESSES: ADMIN,
    OPERATIONAL_SIGNERS: SIGNERS.join(","),
    ...opts.env,
  });
  const kv = await Deno.openKv(":memory:");
  const db = createDb(kv, now, {
    mode: cfg.rateLimitMode,
    log: (line) => deps.log(line), // tests swap deps.log after construction
    alwaysEnforce: config.ALWAYS_ENFORCED_RATE_LIMITS,
  });
  const script: ChainScript = {
    head: 1000,
    receipts: {},
    txs: {},
    badgeHolders: new Set(),
    ethUsd: 2000,
    brokenTokens: new Set(),
    brokenFeeds: new Set(),
    tokenBalances: {},
    ethBalances: {},
    calls: [],
    code: {},
    brokenSafe: false,
  };
  const chain = createChain({ rpc: scriptedRpc(script, now), now });
  const fetchLog: FetchLog = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchLog.push({ url, init });
    if (opts.fetch) return Promise.resolve(opts.fetch(url, init));
    return Promise.resolve(new Response("not mocked", { status: 599 }));
  }) as typeof fetch;
  const deps: Deps = {
    db,
    chain,
    config: cfg,
    fetch: f,
    now,
    funding: createFunding({ db, chain, now }),
    ai: createAi(cfg, f),
    admins: createAdmins(db, cfg, now),
    ens: createEns(f, now),
    pinata: createPinata(cfg, f),
    log: () => {},
    resolve: (host) =>
      Promise.resolve(
        host.endsWith(".invalid") ? [null, "host does not resolve"] : [["93.184.216.34"], null],
      ),
  };
  const app = createApp(deps);
  return {
    app,
    deps,
    db,
    kv,
    script,
    fetchLog,
    clock,
    async mint(address, isAdmin = false) {
      return (await db.sessions.create(address, isAdmin)).token;
    },
    req(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("Origin", ORIGIN);
      if (init.token) headers.set("Authorization", "Bearer " + init.token);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(init.json);
      }
      return Promise.resolve(
        app.request("http://api.test" + path, { ...init, headers, body }, testConnection()),
      );
    },
    close: () => kv.close(),
  };
}

/** Session token for a wallet that already has a site nickname (may submit and edit). */
export async function proposerToken(h: Harness, address = PLAIN): Promise<string> {
  await h.db.profiles.setNickname(address, "Proposer " + address.slice(-4));
  return await h.mint(address);
}

export const j = (r: Response) => r.json() as Promise<Record<string, unknown>>;

export async function loadContentFiles(): Promise<{ name: string; text: string }[]> {
  const dir = new URL("../../content/rfps/", import.meta.url);
  const out = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".md")) {
      out.push({ name: e.name, text: await Deno.readTextFile(new URL(e.name, dir)) });
    }
  }
  return out;
}

/**
 * The repo's content/rfps/logos, registered as already pinned (fake CIDs) so the
 * real content files, whose backers lines name them, sync without Pinata.
 */
export async function seedContentLogos(h: Harness): Promise<string[]> {
  const dir = new URL("../../content/rfps/logos/", import.meta.url);
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !/\.(png|jpe?g|webp)$/i.test(e.name)) continue;
    await h.db.logos.set(e.name.toLowerCase(), "bafytest" + e.name.replace(/\W/g, ""), "sha-test");
    names.push(e.name);
  }
  return names;
}
