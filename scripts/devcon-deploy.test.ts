import { assertEquals, assertNotEquals } from "@std/assert";
import { getAddress, keccak256, slice, toBytes } from "viem";
import { devconSchedule, planInitiatives } from "./devcon-deploy.ts";

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
    getAddress(slice(keccak256(toBytes("devcon8:a")), 12)),
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

Deno.test("devconSchedule: one 1-second window ending at the close", () => {
  const s = devconSchedule(1793800000);
  assertEquals(s, {
    opensAt: 1793800000 + 15 * 60,
    initialWindow: 1,
    firstTallyAt: [1793989799, 1793989800, 1793989801],
    maxWindows: 1,
  });
});
