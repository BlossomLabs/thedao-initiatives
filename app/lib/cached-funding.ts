import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { api, ApiError } from "./api";

/** Paint saved funding and donations before waiting on an optional refresh.
 * The second request keeps server work attached to a request on Deno Deploy.
 * Cancellation must not repopulate queries cleared on navigation/sign-out. */
export async function cachedFunding<T>(
  qc: QueryClient,
  key: QueryKey,
  path: string,
  refreshDue: (data: T) => boolean,
  signal: AbortSignal,
  anonymous = false,
): Promise<T> {
  const snapshot = await api<T>(path, { signal, passive: true, anonymous });
  signal.throwIfAborted();
  if (!refreshDue(snapshot)) return snapshot;
  qc.setQueryData(key, snapshot);
  try {
    return await api<T>(`${path}?refresh=1`, { signal, passive: true, anonymous });
  } catch (e) {
    if (signal.aborted || (e instanceof ApiError && e.status < 500)) throw e;
    // Keep the last saved numbers on screen when the refresh is unavailable.
    return snapshot;
  }
}
