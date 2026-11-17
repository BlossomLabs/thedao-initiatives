import { describe, expect, it } from "vitest";
import { type Hex, zeroHash } from "viem";
import type { VoteManifest } from "./manifest";
import { type BallotEvent, replayRound, roundJson, type RoundSource } from "./replay-round";
import { transcriptOf } from "./transcript";

/** Results only once the chain has confirmed them: the round is judged at the newest
 * block's time, never at the server's clock alone. Block times are whole seconds and
 * strictly increase, so a head at t means no block before t + 1 can still come: a tally
 * time T is confirmed once the head is at T − 1 or later. One block a second here (block
 * b has timestamp b), and the node has seen up to `head`. */

const VOTER: Hex = "0x1563915e194D8CfBA1943570603F7606A3115508";
/** S-Tier's first tally at 1000, one window of 100 s: it settles at 1100. */
const manifest: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x00000000000000000000000000000000000000C0",
  deployBlock: 1,
  opensAt: 0,
  closesAt: 3100,
  schedule: { opensAt: 0, firstTallyAt: [1000, 2000, 3000], initialWindow: 100, maxWindows: 1 },
  poolUsd: "300",
  slugs: ["a", "b", "c"],
  projects: [0, 1, 2].map(() => ({ goalUsd: "100", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};

const ballot = (tokenId: string, b: Hex, block: number): BallotEvent => ({
  tokenId,
  ballot: b,
  voter: VOTER,
  nonce: 1,
  timestamp: block,
  block,
});

/** The chain as a node at `head` sees it: only the ballots in blocks up to it. */
function chainAt(head: number, all: BallotEvent[]): RoundSource {
  const events = all.filter((e) => e.block! <= head);
  return {
    head: () => Promise.resolve({ block: head, timestamp: head }),
    blockBefore: (t) => {
      const b = Math.min(head, t - 1);
      return Promise.resolve({ block: b, timestamp: b });
    },
    stateAt: (b) =>
      Promise.resolve({
        timestamp: b,
        asks: [100n, 100n, 100n],
        poolUsd: 300n,
        poolInitialized: true,
        withdrawn: [],
      }),
    accountingEventBlocks: () => Promise.resolve([]),
    balanceChangeBlocks: () => Promise.resolve([]),
    ballots: () => Promise.resolve({ events, block: BigInt(head) }),
    committed: (_block, tokenIds) => {
      const t = transcriptOf(
        events.map((e) =>
          "revoked" in e
            ? e
            : { tokenId: e.tokenId, voter: e.voter, nonce: BigInt(e.nonce), ballot: e.ballot }
        ),
      );
      return Promise.resolve({
        transcript: t.transcript,
        recordCount: BigInt(t.count),
        hashes: tokenIds.map((id) => t.lastHash.get(id.toString()) ?? zeroHash),
      });
    },
    rulesHistory: () => Promise.resolve({ addedAt: [], pool: [] }),
  };
}

/** Two badges rank a in S-Tier early; a third ranks b, in the last block before the
 * cutoff (1099), which reaches the node only after the clock passed 1100. */
const EARLY = [ballot("1", "0x01ffff", 500), ballot("2", "0x01ffff", 600)];
const LATE = ballot("3", "0xff01ff", 1099);

const replay = (now: number, head: number) =>
  replayRound(manifest, chainAt(head, [...EARLY, LATE]), { now });

describe("results only once the chain confirms them", () => {
  it("a tier still settles while the newest block is before its cutoff, whatever the clock says", async () => {
    // The clock passed 1100 five seconds ago; the newest block is at 1098.
    const st = await replay(1105, 1098);
    expect(st.tiers[0]).toMatchObject({ tier: "S", status: "settling", windowEndsAt: 1100 });
    expect(st.head).toEqual({ block: 1098, timestamp: 1098 });
    expect(roundJson(st, manifest.slugs).head).toEqual({ block: 1098, timestamp: 1098 });
  });

  it("a ballot in the last block before the cutoff counts, though it arrives after the clock passed it", async () => {
    const before = roundJson(await replay(1105, 1098), manifest.slugs);
    expect(Object.keys(before.accepted)).toEqual(["1", "2"]);
    // The block at 1099 lands: nothing before 1100 can still come, the cutoff is confirmed.
    const st = await replay(1106, 1099);
    const json = roundJson(st, manifest.slugs);
    expect(Object.keys(json.accepted)).toEqual(["1", "2", "3"]);
    const s = json.tiers[0];
    expect(s).toMatchObject({ tier: "S", status: "settled", at: 1100 });
    // Three voters share the pool: badge 3 paid for b.
    expect((s as { funded: string[] }).funded).toEqual(["a", "b"]);
    expect((s as { paid: Record<string, Record<string, string>> }).paid["3"]).toEqual({
      b: "100",
    });
  });

  it("a node still behind a cutoff the clock passed a while ago is refused, not served", async () => {
    await expect(replay(1200, 1098)).rejects.toThrow(/behind the tally time/);
  });

  it("a tier waits until the chain has every block before its first tally", async () => {
    const st = await replay(1004, 998);
    expect(st.tiers[0]).toMatchObject({ tier: "S", status: "waiting" });
    expect((await replay(1004, 999)).tiers[0]).toMatchObject({ status: "settling" });
  });

  it("a replay of a past moment is judged at that moment, not at a newer head", async () => {
    const st = await replay(1050, 1500);
    expect(st.tiers[0]).toMatchObject({ tier: "S", status: "settling" });
    expect(st.head.timestamp).toBe(1049);
  });
});
