/** Typed fetch client for the RFP board API.
 *
 * The session travels as an HttpOnly cookie set by `POST /api/auth/verify`
 * (see context/session.tsx), so nothing here ever holds a token: every call
 * just sends credentials. */
/** Same origin by default (the site server hosts the API under /api; the dev
 * server proxies it). Set VITE_API_URL only to point at a remote API. */
export const API_URL = ((import.meta.env?.VITE_API_URL as string | undefined) ?? "").replace(
  /\/+$/,
  "",
);

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  /** Background refreshes authenticate without extending session inactivity. */
  passive?: boolean;
  /** Public reads after local logout must not reuse a cookie left by an offline logout. */
  anonymous?: boolean;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers = new Headers();
  if (opts.passive) headers.set("X-Session-Activity", "passive");
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;
  const res = await fetch(API_URL + path, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    // "include" rather than the default "same-origin" so a build pointed at a
    // remote VITE_API_URL still sends the session cookie.
    credentials: opts.anonymous ? "omit" : "include",
    signal: opts.signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && typeof data === "object" && "error" in data &&
        typeof (data as { error: unknown }).error === "string")
      ? (data as { error: string }).error
      : (data && typeof data === "object" && "detail" in data &&
          typeof (data as { detail: unknown }).detail === "string")
      ? (data as { detail: string }).detail
      : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/** A write refused because an admin paused the site (503 + maintenance flag). */
export const isMaintenance = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 503 && Boolean(e.body) && typeof e.body === "object" &&
  (e.body as { maintenance?: unknown }).maintenance === true;

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong.";

/** A non-JSON GET with the session (markdown exports). Throws ApiError on failure. */
export async function apiText(path: string): Promise<string> {
  const res = await fetch(API_URL + path, { credentials: "include" });
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  return await res.text();
}
