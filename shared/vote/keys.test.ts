import { expect, it } from "vitest";
import { ballotStorageKey, roundId, roundKey } from "./keys";

it("round and browser storage identity includes the chain and normalizes the address", () => {
  const a = { chainId: 1 as const, contract: `0x${"AB".repeat(20)}` as const };
  const b = { ...a, chainId: 11155111 as const };
  expect(roundKey(a)).not.toEqual(roundKey(b));
  expect(roundId(a)).toBe(`1:${a.contract.toLowerCase()}`);
  for (const kind of ["tiers", "skipped", "last"] as const) {
    expect(ballotStorageKey(kind, a, 7)).not.toBe(ballotStorageKey(kind, b, 7));
    expect(ballotStorageKey(kind, a, 7)).toBe(
      ballotStorageKey(kind, { ...a, contract: a.contract.toLowerCase() as `0x${string}` }, 7n),
    );
  }
});
