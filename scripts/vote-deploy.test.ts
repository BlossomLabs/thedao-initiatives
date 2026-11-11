import { assertEquals, assertNotEquals } from "@std/assert";
import { getAddress, keccak256, slice, toBytes } from "viem";
import { planInitiatives, voteSchedule } from "./vote-deploy.ts";

const SAFE = "0x2e72eE36F7575Fae93f94aAeDAA9E77db2259d59";

Deno.test("planInitiatives: board order, Safe as account, goal in six decimals", () => {
  const plan = planInitiatives([
    { slug: "b", goalUsd: 279000, safeAddress: SAFE },
    { slug: "a", goalUsd: 12.5, safeAddress: "" },
  ]);
  assertEquals(plan.map((p) => p.slug), ["b", "a"]);
  assertEquals(plan[0].account, SAFE);
  assertEquals(plan[0].askUsd, 279_000_000_000n);
  assertEquals(plan[1].askUsd, 12_500_000n);
  assertEquals(
    plan[1].account,
    getAddress(slice(keccak256(toBytes("test-round:a")), 12)),
  );
});

Deno.test("planInitiatives: a Safe used twice gets a placeholder the second time", () => {
  const plan = planInitiatives([
    { slug: "x", goalUsd: 1, safeAddress: SAFE },
    { slug: "y", goalUsd: 1, safeAddress: SAFE.toLowerCase() },
  ]);
  assertEquals(plan[0].account, SAFE);
  assertNotEquals(plan[1].account.toLowerCase(), SAFE.toLowerCase());
});

Deno.test("voteSchedule: S a day after opening, quiet windows 2 h down to 15 min", () => {
  const s = voteSchedule(1793800000);
  const open = 1793800000 + 30 * 60;
  const S = open + 24 * 3600;
  const tier = 7200 + 3600 + 1800 + 900;
  assertEquals(s, {
    opensAt: open,
    initialWindow: 7200,
    firstTallyAt: [S, S + tier, S + 2 * tier],
    maxWindows: 4,
  });
});
