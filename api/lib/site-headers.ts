/** Enforced static-site policy. Inline build scripts use hashes; connections use approved origins. */
import { encodeBase64 } from "@std/encoding/base64";

/** Always enforced: no resource-loading directive, so nothing can break. */
export const MINIMAL_CSP = "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** Wallet service origins from the integrations in app/lib/wagmi.ts and app/lib/privy.ts. */
export const CONNECT_ORIGINS = [
  "https://auth.privy.io",
  "https://*.rpc.privy.systems",
  "https://rpc.walletconnect.com",
  "https://rpc.walletconnect.org",
  "https://relay.walletconnect.com",
  "https://relay.walletconnect.org",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "https://pulse.walletconnect.com",
  "https://pulse.walletconnect.org",
  "https://explorer-api.walletconnect.com",
  "https://api.web3modal.com",
  "https://api.web3modal.org",
  "https://keys.walletconnect.com",
  "https://keys.walletconnect.org",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.merkle.io",
  "https://cloudflare-eth.com",
];

/** Extra deployment origins must be explicit, secure, and free of CSP syntax. */
export function connectOrigin(raw: string): string {
  const u = new URL(raw);
  if (
    !["https:", "wss:"].includes(u.protocol) || u.username || u.password ||
    /[\s*;'"<>]/.test(raw)
  ) throw new Error("Invalid CSP connection origin");
  return u.origin;
}

export function fullCsp(
  scriptHashes: readonly string[] = [],
  connectOrigins: readonly string[] = [],
): string {
  const scriptSrc = ["'self'", ...scriptHashes].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${
      [...new Set([...CONNECT_ORIGINS, ...connectOrigins.map(connectOrigin)])].join(" ")
    }`,
    "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export interface SitePolicy {
  /** Sent as Content-Security-Policy. */
  enforced: string;
  /** Sent as Content-Security-Policy-Report-Only; absent when enforcing the full policy. */
  reportOnly: string | null;
}

export function sitePolicy(
  opts: {
    cspEnforce: boolean;
    scriptHashes?: readonly string[];
    connectOrigins?: readonly string[];
  },
): SitePolicy {
  const full = fullCsp(opts.scriptHashes ?? [], opts.connectOrigins);
  return opts.cspEnforce
    ? { enforced: full, reportOnly: null }
    : { enforced: MINIMAL_CSP, reportOnly: full };
}

// -------------------------------------------------------- inline script hashes

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const HAS_SRC = /(?:^|\s)src\s*=/i;

/**
 * Text content of every inline `<script>` in the HTML, in document order.
 * Tags with a `src` attribute load external files (covered by 'self') and
 * are skipped; React Router emits its hydration scripts as
 * `<script type="module" async>`, which are inline and therefore kept.
 */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(SCRIPT_TAG)) {
    if (HAS_SRC.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

/** CSP token for one inline script: 'sha256-<base64 of the UTF-8 text>'. */
export async function scriptHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `'sha256-${encodeBase64(new Uint8Array(digest))}'`;
}

/** Unique hash tokens for every inline script across the given HTML documents. */
export async function scriptHashes(htmls: Iterable<string>): Promise<string[]> {
  const seen = new Set<string>();
  for (const html of htmls) {
    for (const text of inlineScripts(html)) seen.add(await scriptHash(text));
  }
  return [...seen];
}

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* htmlFiles(path);
    else if (entry.isFile && entry.name.endsWith(".html")) yield path;
  }
}

/**
 * Hashes of every inline script in the `*.html` files under `dir`
 * (recursively). A missing directory (dev, no build yet) yields none, and
 * the policy simply carries no hashes.
 */
export async function collectScriptHashes(dir: string): Promise<string[]> {
  const htmls: string[] = [];
  try {
    for await (const path of htmlFiles(dir)) htmls.push(await Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
  return scriptHashes(htmls);
}
