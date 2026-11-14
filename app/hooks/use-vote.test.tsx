import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ROUND } from "../../shared/vote/manifest";
import { roundPollInterval, type RoundView } from "./use-vote";
import { useBallotSubmit } from "./use-vote-send";

vi.mock("~/context/wallet", () => ({ useWallet: () => ({ address: undefined }) }));
vi.mock("~/hooks/use-vote-chain", () => ({ useEnsureVoteChain: () => () => Promise.resolve() }));

it("switching to another badge drops the last badge's ballot (no Retry of the wrong one)", () => {
  sessionStorage.setItem(
    `vote-last:${ROUND.contract}:12`,
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
