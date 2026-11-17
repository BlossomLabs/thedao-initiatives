import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ROUND } from "../../shared/vote/manifest";
import { roundPollInterval, type RoundView } from "./use-vote";
import { useBallotSubmit } from "./use-vote-send";

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock("~/context/wallet", () => ({ useWallet: () => wallet }));
vi.mock("~/hooks/use-vote-chain", () => ({ useEnsureVoteChain: () => () => Promise.resolve() }));

it("switching to another badge drops the last badge's ballot (no Retry of the wrong one)", () => {
  sessionStorage.setItem(
    `vote-last:${ROUND.chainId}:${ROUND.contract.toLowerCase()}:12`,
    JSON.stringify({ tokenId: "12", nonce: "1", ballot: "0x01", signature: "0x02" }),
  );
  const { result, rerender } = renderHook(({ id }) => useBallotSubmit(id), {
    initialProps: { id: 12n as bigint | null },
  });
  expect(result.current.last?.tokenId).toBe(12n);
  rerender({ id: 40n });
  expect(result.current.last).toBeNull();
  rerender({ id: 12n });
  expect(result.current.last?.tokenId).toBe(12n);
});

it("a closed round keeps polling, more slowly, until its final what-ifs arrive", () => {
  const view = (v: Partial<RoundView>) => ({ closed: false, ...v }) as RoundView;
  expect(roundPollInterval(undefined, 5_000)).toBe(5_000);
  expect(roundPollInterval(view({}), 5_000)).toBe(5_000);
  expect(roundPollInterval(view({ closed: true }), 5_000)).toBe(15_000);
  expect(roundPollInterval(view({ closed: true }), 30_000)).toBe(30_000);
  expect(roundPollInterval(view({ closed: true, final: { next: {}, lead: {} } }), 5_000))
    .toBe(false);
  // A page that never polled doesn't start because the round closed.
  expect(roundPollInterval(view({ closed: true }), false)).toBe(false);
});

it("a closed round with what-ifs keeps polling until its settlements are confirmed", () => {
  const pending = {
    closed: true,
    final: { next: {}, lead: {} },
    tiers: [{ status: "settled", confirmed: false }],
  } as unknown as RoundView;
  expect(roundPollInterval(pending, 5000)).toBe(15000);
  const final = { ...pending, tiers: [{ ...pending.tiers[0], confirmed: true }] } as RoundView;
  expect(roundPollInterval(final, 5000)).toBe(false);
});

it("switching chains at the same contract and badge clears an in-memory last send", () => {
  const original = ROUND.chainId;
  try {
    sessionStorage.setItem(
      `vote-last:${original}:${ROUND.contract.toLowerCase()}:42`,
      JSON.stringify({ tokenId: "42", nonce: "1", ballot: "0x01", signature: "0x02" }),
    );
    const { result, rerender, unmount } = renderHook(() => useBallotSubmit(42n));
    expect(result.current.last?.tokenId).toBe(42n);
    ROUND.chainId = original === 1 ? 11155111 : 1;
    rerender();
    expect(result.current.last).toBeNull();
    expect(result.current.phase.kind).toBe("idle");
    unmount();
  } finally {
    ROUND.chainId = original;
    sessionStorage.clear();
  }
});

it("a send finishing after a chain switch only saves under its original round", async () => {
  const original = ROUND.chainId;
  const hash = `0x${"11".repeat(32)}` as const;
  let resolve!: (hash: `0x${string}`) => void;
  const landing = {
    promise: new Promise<`0x${string}`>((r) => {
      resolve = r;
    }),
    resolve: (hash: `0x${string}`) => resolve(hash),
  };
  wallet.address = `0x${"22".repeat(20)}`;
  const { result, rerender, unmount } = renderHook(() => useBallotSubmit(77n));
  try {
    const d = result.current.deps;
    d.ensureChain = vi.fn(async () => {});
    d.nonceOf = vi.fn(() => Promise.resolve(0n));
    d.signVote = vi.fn(() => Promise.resolve("0x1234" as const));
    d.relay = vi.fn(() => landing.promise);
    d.waitResult = vi.fn(() => Promise.resolve("recorded" as const));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.submit(77n, "0x01");
      await Promise.resolve();
    });
    await waitFor(() => expect(d.relay).toHaveBeenCalled());
    ROUND.chainId = original === 1 ? 11155111 : 1;
    rerender();
    await act(async () => {
      landing.resolve(hash);
      await pending;
    });
    expect(result.current.last).toBeNull();
    expect(result.current.phase.kind).toBe("idle");
    expect(sessionStorage.getItem(`vote-last:${ROUND.chainId}:${ROUND.contract.toLowerCase()}:77`))
      .toBeNull();
    expect(
      JSON.parse(
        sessionStorage.getItem(`vote-last:${original}:${ROUND.contract.toLowerCase()}:77`)!,
      ),
    ).toMatchObject({ hash });
  } finally {
    unmount();
    ROUND.chainId = original;
    wallet.address = undefined;
    sessionStorage.clear();
  }
});

it("a recorded send waits for its own replay nonce before the counted phase", async () => {
  const { result, unmount } = renderHook(() => useBallotSubmit(88n));
  try {
    result.current.deps.waitResult = vi.fn(() => Promise.resolve("recorded" as const));
    await act(() =>
      result.current.track(`0x${"11".repeat(32)}`, {
        tokenId: 88n,
        nonce: 2n,
        ballot: "0x01",
        signature: "0x1234",
      })
    );
    expect(result.current.phase.kind).toBe("recorded");
    const view = {
      accepted: { "88": "0x01" },
      acceptedNonces: { "88": 1 },
      rejected: [],
    } as unknown as RoundView;
    act(() => result.current.confirm(view));
    expect(result.current.phase.kind).toBe("recorded");
    act(() => result.current.confirm({ ...view, acceptedNonces: { "88": 2 } }));
    expect(result.current.phase.kind).toBe("counted");
  } finally {
    unmount();
    sessionStorage.clear();
  }
});

it("a mined revision rejected by replay never reaches the counted phase", async () => {
  const { result, unmount } = renderHook(() => useBallotSubmit(89n));
  try {
    result.current.deps.waitResult = vi.fn(() => Promise.resolve("recorded" as const));
    await act(() =>
      result.current.track(`0x${"11".repeat(32)}`, {
        tokenId: 89n,
        nonce: 2n,
        ballot: "0x01",
        signature: "0x1234",
      })
    );
    act(() =>
      result.current.confirm(
        {
          accepted: { "89": "0x02" },
          acceptedNonces: { "89": 1 },
          rejected: [{ tokenId: "89", nonce: 2, reason: "tier_settled" }],
        } as unknown as RoundView,
      )
    );
    expect(result.current.phase.kind).toBe("rejected");
  } finally {
    unmount();
    sessionStorage.clear();
  }
});
