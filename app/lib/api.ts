/** Typed fetch client for the RFP board API.
 *
 * The session travels as an HttpOnly cookie set by `POST /api/auth/verify`
 * (see context/session.tsx), so nothing here ever holds a token: every call
 * just sends credentials. */
import { walletErrorMessage } from "./donate";
import { API_URL } from "./api-url";
import { takeEarly } from "./early-fetch";
import { noteServerVersion } from "./app-upgrade";

export { API_URL };

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  const method = opts.method ?? (body ? "POST" : "GET");
  const request = () =>
    fetch(API_URL + path, {
      method,
      headers,
      body,
      // "include" rather than the default "same-origin" so a build pointed at a
      // remote VITE_API_URL still sends the session cookie.
      credentials: opts.anonymous ? "omit" : "include",
      signal: opts.signal,
    });
  // A read the page started before the app loaded (early-fetch.ts) is used as
  // is; if that request failed, this one is sent like any other. It carried
  // the cookie, so an anonymous read (after a local logout) never takes it.
  const early = method === "GET" && !opts.anonymous ? takeEarly(path) : undefined;
  const res = early ? await early.catch(() => request()) : await request();
  noteServerVersion(res);
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

/** Server errors and wallet fragments are written lowercase with no full stop
 * ("slow down"); on screen they read as a sentence. */
export const sentence = (s: string): string => {
  const t = s.trim();
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1) + (/[.!?…:]$/.test(t) ? "" : ".");
};

/** A wallet or viem failure rather than one of ours: those carry an EIP-1193
 * code or viem's shortMessage, and their message is a developer dump. */
const isWalletError = (e: unknown): boolean =>
  !(e instanceof ApiError) && typeof e === "object" && e !== null &&
  (typeof (e as { code?: unknown }).code === "number" ||
    typeof (e as { shortMessage?: unknown }).shortMessage === "string");

/** The line to show a person for any thrown value. */
export const errorMessage = (e: unknown, fallback = "Something went wrong."): string => {
  if (e instanceof ApiError && e.status >= 500 && e.message === "internal error") {
    return "Something went wrong on our side. Please try again in a moment.";
  }
  if (isWalletError(e)) return sentence(walletErrorMessage(e));
  // A bug's own message ("Cannot read properties of undefined") means nothing
  // to a visitor: it goes to the console, and the page says something plain.
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) {
    if (/fetch|network|load failed/i.test(e.message)) {
      return "Could not reach the server. Check your connection and try again.";
    }
    console.error(e);
    return fallback;
  }
  return e instanceof Error ? sentence(e.message) : typeof e === "string" ? sentence(e) : fallback;
};

/** A non-JSON GET with the session (markdown exports). Throws ApiError on failure. */
export async function apiText(path: string): Promise<string> {
  const res = await fetch(API_URL + path, { credentials: "include" });
  noteServerVersion(res);
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  return await res.text();
}
