import { ApiError } from "./api";

/** Retry only an explicit, pre-mutation authentication challenge, and only once. */
export async function withReauthentication<T>(
  request: () => Promise<T>,
  signIn: () => Promise<unknown>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      !(error instanceof ApiError) || error.status !== 403 ||
      !error.body || typeof error.body !== "object" ||
      !("reauthenticate" in error.body) || error.body.reauthenticate !== true
    ) throw error;
    await signIn();
    return await request();
  }
}
