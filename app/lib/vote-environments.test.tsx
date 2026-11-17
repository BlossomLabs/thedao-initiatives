import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { NO_ROUND, type VoteManifest } from "../../shared/vote/manifest";
import { ballotStorageKey, roundKey } from "../../shared/vote/keys";
import {
  loadRound,
  primeRound,
  scopeVotePath,
  useRound,
  VoteEnvironmentContext,
} from "./vote-round";
vi.mock(
  "./api",
  async (original) => ({ ...await original<typeof import("./api")>(), api: vi.fn() }),
);
afterEach(cleanup);
const test: VoteManifest = { ...NO_ROUND, contract: `0x${"12".repeat(20)}` };
const production: VoteManifest = {
  ...test,
  kind: "real",
  chainId: 1,
  badge: `0x${"34".repeat(20)}`,
  currencies: ["ETH", "DAI"].map((symbol) => ({
    symbol,
    asset: test.contract,
    usdFeed: test.contract,
  })),
  accounts: [],
};

it("concurrent manifest responses stay in their own environment even when test finishes last", async () => {
  let finishTest!: (value: { manifest: VoteManifest }) => void;
  vi.mocked(api).mockImplementation((path) =>
    path === "/api/vote-test/manifest"
      ? new Promise((resolve) => {
        finishTest = resolve as typeof finishTest;
      })
      : Promise.resolve({ manifest: production }) as never
  );
  const prod = renderHook(useRound);
  const sandbox = renderHook(useRound, {
    wrapper: ({ children }) => (
      <VoteEnvironmentContext.Provider value="test">{children}</VoteEnvironmentContext.Provider>
    ),
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = loadRound("test");
    await loadRound("production");
  });
  expect(prod.result.current).toEqual(production);
  await act(async () => {
    finishTest({ manifest: test });
    await pending;
  });
  expect(sandbox.result.current).toEqual(test);
  expect(prod.result.current).toEqual(production);
});
it("missing test configuration clears only the test round", async () => {
  primeRound(test);
  primeRound(production);
  const prod = renderHook(useRound);
  const sandbox = renderHook(useRound, {
    wrapper: ({ children }) => (
      <VoteEnvironmentContext.Provider value="test">{children}</VoteEnvironmentContext.Provider>
    ),
  });
  vi.mocked(api).mockResolvedValue({ manifest: null });
  await act(() => loadRound("test"));
  await waitFor(() => expect(sandbox.result.current).toEqual(NO_ROUND));
  expect(prod.result.current).toEqual(production);
});
it("round records and badge drafts include the environment even at an identical chain and address", () => {
  const other = { ...test, kind: "real" as const };
  expect(roundKey(test)).not.toEqual(roundKey(other));
  for (const kind of ["tiers", "skipped", "last"] as const) {
    expect(ballotStorageKey(kind, test, 1)).not.toBe(ballotStorageKey(kind, other, 1));
  }
  expect(scopeVotePath("/api/vote/ballot", "test")).toBe("/api/vote-test/ballot");
  expect(scopeVotePath("/api/admin/vote-round/pool", "test")).toBe(
    "/api/admin/vote-test-round/pool",
  );
  expect(scopeVotePath("/api/vote/ballot", "production")).toBe("/api/vote/ballot");
});
