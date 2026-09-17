import { expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import { fetchMine, mineKey } from "./api";

vi.mock("~/lib/api", () => ({ api: vi.fn().mockResolvedValue({ held: [] }) }));

it("sends comment capabilities in the POST body and uses an opaque cache key", async () => {
  const tokens = ["a".repeat(32)];
  const signal = new AbortController().signal;
  await fetchMine(tokens, signal);
  expect(api).toHaveBeenCalledWith("/api/comments/mine", {
    json: { tokens },
    signal,
    anonymous: true,
  });
  expect(mineKey("opaque-scope")).toEqual(["comments-mine", "opaque-scope"]);
});
