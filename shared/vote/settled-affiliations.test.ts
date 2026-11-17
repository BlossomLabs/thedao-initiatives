import { describe, expect, it } from "vitest";
import { checkBallot, type RulesRound } from "./rules";
import { type ChainState, type Receipt, refusal, replay, type Schedule } from "./quiet-ending";

const schedule: Schedule = {
  opensAt: 0,
  firstTallyAt: [100, 200, 300],
  initialWindow: 10,
  maxWindows: 1,
};
const goals = [100n, 50n, 50n, 100n, 50n, 50n, 100n, 100n];
const round: RulesRound = {
  projects: goals.map((goalUsd, i) => ({ goalUsd, rfp: false, groups: i % 3 === 0 ? [i] : [] })),
  asks: goals,
  groupNames: goals.map((_, i) => `Affiliation ${i}`),
  poolUsd: 300n,
  independentTiers: 3,
};
const original = Uint8Array.of(1, 1, 1, 4, 4, 4, 7, 255);
const receipts: Receipt[] = [{ tokenId: "1", nonce: 1, ballot: original, block: 1, timestamp: 1 }];

describe("settled affiliation goals", () => {
  for (const tier of [0, 1] as const) {
    it(`outside support leaves later choices editable after ${tier === 0 ? "S-Tier" : "A-Tier"} settles`, () => {
      const at = schedule.firstTallyAt[tier] + 11;
      const asks = [...goals];
      asks[tier * 3 + 1] -= 1n;
      const states: ChainState[] = [
        {
          block: 0,
          timestamp: 0,
          asks: goals,
          poolUsd: 300n,
          poolInitialized: true,
          withdrawn: [],
          event: false,
        },
        {
          block: at,
          timestamp: at,
          asks,
          poolUsd: 300n,
          poolInitialized: true,
          withdrawn: [],
          event: true,
        },
      ];
      const input = { schedule, m: goals.length, states, receipts };
      const before = replay(input, at + 9);
      expect(before.tiers[tier].status).toBe("settled");
      // Change only the still-open choices, preserving both independent triples.
      const revision = tier === 0
        ? Uint8Array.of(1, 1, 1, 4, 4, 7, 4, 255)
        : Uint8Array.of(1, 1, 1, 4, 4, 4, 255, 7);
      expect(checkBallot(original, round).ok).toBe(true);
      expect(checkBallot(revision, { ...round, asks }).ok).toBe(true);
      expect(refusal(before, "1", revision, at + 2, goals.length)).toBeNull();
      const after = replay({
        ...input,
        receipts: [...receipts, {
          tokenId: "1",
          nonce: 2,
          ballot: revision,
          block: at + 1,
          timestamp: at + 1,
        }],
      }, at + 9);
      expect(after.acceptedNonces.get("1")).toBe(2);
      expect(after.rejected).toEqual([]);
      expect(after.tiers[tier]).toEqual(before.tiers[tier]);
      // Goal-based validation grants no exemption from the frozen membership rule.
      const moved = Uint8Array.of(1, 1, 1, 1, 5, 5, 5, 255);
      expect(refusal(before, "1", moved, at + 2, goals.length)).toEqual({
        code: "tier_settled",
        tier: "S",
      });
      if (tier === 1) {
        expect(refusal(before, "1", Uint8Array.of(1, 1, 1, 4, 4, 7, 4, 255), at + 2, goals.length))
          .toEqual({ code: "tier_settled", tier: "A" });
      }
    });
  }
});
