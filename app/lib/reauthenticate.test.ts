import { expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { withReauthentication } from "./reauthenticate";
it("signs once for an explicit challenge and retries exactly once", async () => {
  const request = vi.fn().mockRejectedValueOnce(
    new ApiError(403, "renew", { reauthenticate: true }),
  ).mockResolvedValue("saved");
  const signIn = vi.fn().mockResolvedValue({});
  expect(await withReauthentication(request, signIn)).toBe("saved");
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(2);
});
it("never retries a mutation for an ordinary denial, network failure, or refused signature", async () => {
  for (const error of [new ApiError(403, "admin only"), new Error("network")]) {
    const request = vi.fn().mockRejectedValue(error), signIn = vi.fn();
    await expect(withReauthentication(request, signIn)).rejects.toBe(error);
    expect(signIn).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  }
  const request = vi.fn().mockRejectedValue(new ApiError(403, "renew", { reauthenticate: true }));
  await expect(withReauthentication(request, () => Promise.reject(new Error("refused")))).rejects
    .toThrow("refused");
  expect(request).toHaveBeenCalledTimes(1);
});
