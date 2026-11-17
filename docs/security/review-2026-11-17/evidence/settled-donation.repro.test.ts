import { assertEquals } from "@std/assert";
import { checkBallot, type RulesRound } from "../../../../shared/vote/rules.ts";
import {
  type ChainState,
  type Receipt,
  refusal,
  replay,
  type Schedule,
} from "../../../../shared/vote/quiet-ending.ts";

Deno.test("NOV-02: a third-party donation blocks every revision preserving the settled S-Tier", () => {
  const unit = 1_000_000n;
  const original = Uint8Array.of(1, 1, 1, 4, 5);
  const revision = Uint8Array.of(1, 1, 1, 5, 4);
  const repair = Uint8Array.of(1, 1, 1, 1, 5);
  const asks = [100_000n, 50_000n, 50_000n, 100_000n, 100_000n].map((x) => x * unit);
  const round: RulesRound = {
    projects: asks.map((goalUsd, i) => ({ goalUsd, rfp: false, groups: i === 0 ? [0] : [] })),
    asks,
    poolUsd: 300_000n * unit,
    independentTiers: 1,
    groupNames: ["Affiliation"],
  };
  assertEquals(checkBallot(original, round).ok, true);
  assertEquals(checkBallot(revision, round).ok, true);
  const after = [...asks];
  after[1] -= unit;
  const schedule: Schedule = {
    opensAt: 0,
    firstTallyAt: [100, 200, 300],
    initialWindow: 10,
    maxWindows: 1,
  };
  const receipts: Receipt[] = [{
    tokenId: "1",
    nonce: 1,
    ballot: original,
    block: 1,
    timestamp: 1,
  }];
  const states: ChainState[] = [
    {
      block: 0,
      timestamp: 0,
      asks,
      poolUsd: round.poolUsd,
      poolInitialized: true,
      withdrawn: [],
      event: false,
    },
    {
      block: 111,
      timestamp: 111,
      asks: after,
      poolUsd: round.poolUsd,
      poolInitialized: true,
      withdrawn: [],
      event: true,
    },
  ];
  const state = replay({ schedule, m: 5, states, receipts }, 120);
  assertEquals(state.tiers[0].status, "settled");
  assertEquals(refusal(state, "1", revision, 120, 5), null);
  const checked = checkBallot(revision, { ...round, asks: after });
  assertEquals(checked.ok, false);
  assertEquals(checked.errors, [{
    rule: "group",
    tier: 0,
    group: 0,
    groupUsd: 100_000n * unit,
    tierUsd: 199_999n * unit,
  }]);
  assertEquals(checkBallot(repair, { ...round, asks: after }).ok, true);
  assertEquals(refusal(state, "1", repair, 120, 5), { code: "tier_settled", tier: "S" });
  const repaired = replay({
    schedule,
    m: 5,
    states,
    receipts: [...receipts, { tokenId: "1", nonce: 2, ballot: repair, block: 112, timestamp: 112 }],
  }, 120);
  assertEquals(repaired.rejected, [{ tokenId: "1", nonce: 2, reason: "tier_settled" }]);
  assertEquals(repaired.acceptedNonces.get("1"), 1);
  console.log(
    "Unchanged S-Tier fails the current group rule; repaired S-Tier is rejected by replay; original nonce 1 remains accepted.",
  );
});
