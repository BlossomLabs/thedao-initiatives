/** Browser-side avatar fallback. The API resolves avatars on the server, but
 * an NFT avatar whose metadata host is gone can only be served from a copy
 * (OpenSea's, via ensdata.net), and ensdata is not reachable from the
 * server's egress. The browser asks it directly, once per name. */

const ENSDATA = "https://api.ensdata.net/";

/** Only https URLs go into an <img src>. */
export function httpsUrl(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 500 ? s : null;
}

export async function ensdataAvatar(name: string): Promise<string | null> {
  const res = await fetch(ENSDATA + encodeURIComponent(name), {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`ensdata ${res.status}`);
  const data = (await res.json()) as { avatar_url?: unknown; avatar?: unknown };
  return httpsUrl(data.avatar_url) ?? httpsUrl(data.avatar);
}
