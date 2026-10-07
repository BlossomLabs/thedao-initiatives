/** Same origin by default (the site server hosts the API under /api; the dev
 * server proxies it). Set VITE_API_URL only to point at a remote API. Its own
 * module so the head script in early-fetch.ts can share it without a cycle. */
export const API_URL = ((import.meta.env?.VITE_API_URL as string | undefined) ?? "").replace(
  /\/+$/,
  "",
);
