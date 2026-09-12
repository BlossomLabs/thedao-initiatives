/**
 * Alchemy Address Activity webhooks as a *trigger* for the Safe sync.
 *
 * Alchemy tells us "something moved into this address"; nothing in the
 * payload is trusted for money. The receiver maps the recipient to an
 * initiative and queues the same `syncSafe` the cron runs, which re-verifies
 * every tx over RPC / the Safe indexer. A spoofed call therefore costs one
 * Safe API request at most, and the signature check stops even that.
 *
 * Two dashboard secrets, neither of which is the app API key:
 *  - the webhook's signing key verifies `X-Alchemy-Signature` (HMAC-SHA256 of
 *    the raw body, hex);
 *  - the Notify auth token + webhook id let the server add a new Safe to the
 *    webhook's address list when an admin confirms it.
 */
import { encodeHex } from "@std/encoding";
import type { Config } from "../config.ts";

export const ALCHEMY_SIGNATURE_HEADER = "x-alchemy-signature";
export const ALCHEMY_NOTIFY_ADDRESSES =
  "https://dashboard.alchemy.com/api/update-webhook-addresses";
/** Mainnet is the only chain the board takes donations on. */
const NETWORK = "ETH_MAINNET";
/** Activity kinds that move ETH or ERC-20s; NFTs are noise here. */
const TRANSFER_CATEGORIES = new Set(["external", "internal", "erc20", "token"]);

const enc = new TextEncoder();

export async function signBody(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeHex(await crypto.subtle.sign("HMAC", k, enc.encode(body)));
}

function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function signatureOk(key: string, body: string, sig: string): Promise<boolean> {
  if (!key || !sig) return false;
  return same(await signBody(key, body), sig.trim().toLowerCase());
}

interface Activity {
  hash?: string;
  toAddress?: string;
  category?: string;
}

/**
 * Recipient address (lowercase) -> tx hashes (lowercase) from one webhook
 * event. Anything that is not a mainnet ADDRESS_ACTIVITY transfer is ignored.
 */
export function recipientsOf(payload: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!payload || typeof payload !== "object") return out;
  const p = payload as { type?: string; event?: { network?: string; activity?: Activity[] } };
  if (p.type !== "ADDRESS_ACTIVITY" || p.event?.network !== NETWORK) return out;
  for (const a of p.event.activity ?? []) {
    if (!a || typeof a !== "object") continue;
    if (!TRANSFER_CATEGORIES.has(String(a.category ?? ""))) continue;
    const to = String(a.toAddress ?? "").toLowerCase();
    const hash = String(a.hash ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(to) || !/^0x[0-9a-f]{64}$/.test(hash)) continue;
    const set = out.get(to) ?? new Set<string>();
    set.add(hash);
    out.set(to, set);
  }
  return out;
}

export interface RegisterDeps {
  config: Pick<Config, "alchemyAuthToken" | "alchemyWebhookId">;
  fetch: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * Add Safe addresses to the configured Address Activity webhook.
 * "skipped" when the Notify token / webhook id are not set (addresses are
 * then added by hand in the dashboard); otherwise "registered" or the error.
 */
export async function registerSafeAddresses(
  deps: RegisterDeps,
  addresses: string[],
): Promise<"registered" | "skipped" | `error: ${string}`> {
  const { alchemyAuthToken: token, alchemyWebhookId: id } = deps.config;
  if (!token || !id) return "skipped";
  if (!addresses.length) return "registered";
  try {
    const res = await deps.fetch(ALCHEMY_NOTIFY_ADDRESSES, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Alchemy-Token": token,
      },
      body: JSON.stringify({
        webhook_id: id,
        addresses_to_add: addresses,
        addresses_to_remove: [],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      const msg = `Alchemy Notify HTTP ${res.status}${text ? ": " + text : ""}`;
      deps.log?.(`alchemy register: ${msg}`);
      return `error: ${msg}`;
    }
    deps.log?.(`alchemy register: ${addresses.length} address(es) added to ${id}`);
    return "registered";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.log?.(`alchemy register: ${msg}`);
    return `error: ${msg}`;
  }
}
