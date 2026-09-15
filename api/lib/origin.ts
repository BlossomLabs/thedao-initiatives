import type { Config } from "../config.ts";

/**
 * The origin this request was served on, if it is one we would serve on.
 *
 * Deno Deploy answers on several hostnames (the custom domain, the production
 * and per-branch *.deno.net URLs), so "same origin" cannot be one fixed env
 * value. The request's own host is only trustworthy when the edge in front of
 * us routes by hostname, so it is accepted solely for hosts under
 * SELF_HOST_SUFFIXES (the platform's own domains, which nobody else can point
 * at this app); everything else must be listed in WEB_ORIGIN. Behind a
 * TLS-terminating proxy the runtime sees plain http; with TRUST_PROXY the
 * proxy's X-Forwarded-Proto restores the public scheme.
 */
export function selfOrigin(req: Request, config: Config): string | null {
  const url = new URL(req.url);
  if (!config.selfHostSuffixes.some((s) => url.hostname.endsWith(s))) return null;
  if (config.trustProxy) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    if (proto === "http" || proto === "https") url.protocol = proto + ":";
  }
  return url.origin;
}
