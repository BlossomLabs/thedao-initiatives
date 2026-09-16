/**
 * CSP policy for the static site. Shared Hono middleware applies the headers;
 * API routes select their own resource-blocking policy.
 *
 * The full Content-Security-Policy ships report-only by default, so
 * violations show up in the browser console without breaking wallet flows
 * (browser-extension connectors, WalletConnect, Privy, RPC and IPFS hosts)
 * that cannot all be exercised from a test environment. CSP_ENFORCE=true
 * promotes it to the enforced header once the report-only data is clean.
 * Even when not enforcing, the directives that cannot break resource loading
 * (frame-ancestors, base-uri, form-action) are always enforced, so the donate
 * widget and the admin dashboard can never be framed.
 */
import { encodeBase64 } from "@std/encoding/base64";

/** Always enforced: no resource-loading directive, so nothing can break. */
export const MINIMAL_CSP = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * The full policy. `connect-src https: wss:` is deliberately broad for the
 * first iteration: the wallet SDKs (wagmi injected connectors, the
 * WalletConnect relay, Privy), the public RPC endpoints (config.ts
 * DEFAULT_RPC_ENDPOINTS plus RPC_URL/Alchemy) and the IPFS gateway
 * (PINATA_GATEWAY) talk to many hosts. Narrow it to an explicit host list
 * once the report-only violations have been watched over a few releases.
 */
export function fullCsp(scriptHashes: readonly string[] = []): string {
  const scriptSrc = ["'self'", ...scriptHashes].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "frame-src https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export interface SitePolicy {
  /** Sent as Content-Security-Policy. */
  enforced: string;
  /** Sent as Content-Security-Policy-Report-Only; absent when enforcing the full policy. */
  reportOnly: string | null;
}

export function sitePolicy(
  opts: { cspEnforce: boolean; scriptHashes?: readonly string[] },
): SitePolicy {
  const full = fullCsp(opts.scriptHashes ?? []);
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
