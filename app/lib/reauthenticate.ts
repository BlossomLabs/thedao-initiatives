import { ApiError } from "./api";

/** The server's explicit challenge for a fresh signature (requireRecentAuth). */
export const needsReauthentication = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 &&
  Boolean(error.body) && typeof error.body === "object" &&
  "reauthenticate" in (error.body as object) &&
  (error.body as { reauthenticate?: unknown }).reauthenticate === true;

/** Retry only an explicit, pre-mutation authentication challenge, and only once. */
export async function withReauthentication<T>(
  request: () => Promise<T>,
  signIn: () => Promise<unknown>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!needsReauthentication(error)) throw error;
    await signIn();
    return await request();
  }
}
