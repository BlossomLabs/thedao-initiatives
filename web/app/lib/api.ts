/** Typed fetch client for the RFP board API. */
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

let tokenProvider: () => string | null = () => null;
/** Registered by the session context so every call carries the bearer. */
export function setTokenProvider(fn: () => string | null) {
  tokenProvider = fn;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  token?: string | null;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers = new Headers();
  const token = opts.token === undefined ? tokenProvider() : opts.token;
  if (token) headers.set("Authorization", "Bearer " + token);
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;
  const res = await fetch(API_URL + path, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
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

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong.";
