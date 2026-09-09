/**
 * Best-effort Discourse topic title (port of app.py fetch_discourse_title).
 * SSRF-hardened: the host must resolve only to public IPs (checked right
 * before the request), redirects are not followed, 6 s timeout, 512 KB cap.
 */
import { MAX_TITLE } from "../config.ts";
import { resolvePublicIps } from "../lib/validate.ts";

export async function fetchDiscourseTitle(
  topicUrl: string,
  f: typeof fetch = fetch,
  resolve: typeof resolvePublicIps = resolvePublicIps,
): Promise<string | null> {
  try {
    const u = new URL(topicUrl);
    if (u.protocol !== "https:") return null;
    const [ips] = await resolve(u.hostname.toLowerCase());
    if (!ips) return null;
    const jsonUrl = new URL(
      u.pathname.replace(/\/+$/, "") + ".json",
      `https://${u.host}`,
    );
    const res = await f(jsonUrl.toString(), {
      headers: { "User-Agent": "thedao-rfps/2.0", Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 512 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const text = new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks));
    const data = JSON.parse(text) as { title?: unknown };
    const title = String(data.title ?? "").trim();
    return title ? title.slice(0, MAX_TITLE) : null;
  } catch {
    return null;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
