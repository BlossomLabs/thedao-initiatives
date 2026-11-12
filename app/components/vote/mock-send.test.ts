import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMockBallotSubmit } from "./mock-send";

afterEach(() => vi.useRealTimers());

it("Send goes through the real steps, then counts the ballot, with nothing signed or sent", async () => {
  vi.useFakeTimers();
  const counted = vi.fn();
  const { result } = renderHook(() => useMockBallotSubmit(counted));
  expect(result.current.phase.kind).toBe("idle");
  await act(async () => {
    await result.current.submit(1n, "0x01ffff");
  });
  const kinds: string[] = [result.current.phase.kind];
  for (let i = 0; i < 4; i++) {
    act(() => vi.advanceTimersByTime(1100));
    if (kinds.at(-1) !== result.current.phase.kind) kinds.push(result.current.phase.kind);
  }
  expect(kinds).toEqual(["signing", "relaying", "waiting", "counted"]);
  expect(counted).toHaveBeenCalledWith("0x01ffff");
  // No transaction: no Etherscan link to a made-up hash.
  expect(result.current.phase).toEqual({ kind: "counted", hash: "0x" });
});

it("Send it yourself has the same steps; reset goes back to nothing sent", () => {
  vi.useFakeTimers();
  const counted = vi.fn();
  const { result } = renderHook(() => useMockBallotSubmit(counted));
  act(() => {
    void result.current.selfSend(1n, "0x02");
  });
  expect(result.current.phase.kind).toBe("signing");
  act(() => vi.advanceTimersByTime(1100));
  expect(result.current.phase.kind).toBe("relaying");
  act(() => result.current.reset());
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.phase.kind).toBe("idle");
  expect(counted).not.toHaveBeenCalled();
});
