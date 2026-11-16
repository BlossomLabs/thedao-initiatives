import { describe, expect, it } from "vitest";
import { type Hex, zeroHash } from "viem";
import type { StateCache } from "./chain-states";
import type { VoteManifest } from "./manifest";
import { type BallotEvent, replayRound, roundJson, type RoundSource } from "./replay-round";
import { transcriptOf } from "./transcript";

const VOTER: Hex = "0x1563915e194D8CfBA1943570603F7606A3115508";
/** S-Tier's first tally at 1000, one window of 100 s: it settles at 1100 if quiet. */
const manifest: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x00000000000000000000000000000000000000C0",
  deployBlock: 1,
  opensAt: 0,
  closesAt: 3100,
  schedule: { opensAt: 0, firstTallyAt: [1000, 2000, 3000], initialWindow: 100, maxWindows: 1 },
  poolUsd: "200",
  slugs: ["a", "b", "c"],
  projects: [0, 1, 2].map(() => ({ goalUsd: "150", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};

/** One block a second: block b has timestamp b. Two badges rank a in S-Tier. */
function fakeSource(o: { head: number; transcript?: Hex }) {
  const events: BallotEvent[] = [
    { tokenId: "1", ballot: "0x01ffff", voter: VOTER, nonce: 1, timestamp: 500, block: 500 },
    { tokenId: "2", ballot: "0x01ffff", voter: VOTER, nonce: 1, timestamp: 600, block: 600 },
  ];
  const stateReads: number[] = [];
  const src: RoundSource = {
    head: () => Promise.resolve({ block: o.head, timestamp: o.head }),
    blockBefore: (t) => {
      const b = Math.min(o.head, t - 1);
      return Promise.resolve({ block: b, timestamp: b });
    },
    stateAt: (b) => {
      stateReads.push(b);
      return Promise.resolve({
        timestamp: b,
        asks: [150n, 150n, 150n],
        poolUsd: 200n,
        withdrawn: [],
      });
    },
    accountingEventBlocks: () => Promise.resolve([]),
    balanceChangeBlocks: () => Promise.resolve([]),
    ballots: () => Promise.resolve({ events, block: BigInt(o.head) }),
    committed: (_block, tokenIds) => {
      const t = transcriptOf(
        events.map((e) =>
          "revoked" in e
            ? e
            : { tokenId: e.tokenId, voter: e.voter, nonce: BigInt(e.nonce), ballot: e.ballot }
        ),
      );
      return Promise.resolve({
        transcript: o.transcript ?? t.transcript,
        recordCount: BigInt(t.count),
        hashes: tokenIds.map((id) => t.lastHash.get(id.toString()) ?? zeroHash),
      });
    },
    rulesHistory: () => Promise.resolve({ addedAt: [], pool: [] }),
  };
  return { src, stateReads };
}

const memoryCache = (): StateCache => {
  const map = new Map<string, unknown>();
  return {
    get: (k) => Promise.resolve(map.get(k)),
    set: (k, v) => Promise.resolve(void map.set(k, structuredClone(v))),
  };
};

describe("replayRound", () => {
  it("replayRound gives the same result with and without a cache", async () => {
    const opts = { now: 1500, finalAfterSecs: 10 };
    const plain = await replayRound(manifest, fakeSource({ head: 1499 }).src, opts);
    const cache = memoryCache();
    const warm = fakeSource({ head: 1499 });
    const first = await replayRound(manifest, warm.src, { ...opts, cache });
    const readsCold = warm.stateReads.length;
    const second = await replayRound(manifest, warm.src, { ...opts, cache });
    // The second replay reads only the head again: everything older came from the cache.
    expect(warm.stateReads.length - readsCold).toBeLessThan(readsCold);
    expect(plain.tiers[0].status).toBe("settled");
    for (const x of [first, second]) {
      expect(roundJson(x, manifest.slugs)).toEqual(roundJson(plain, manifest.slugs));
      expect(x.transcript).toEqual(plain.transcript);
    }
    expect(plain.transcript).toMatchObject({ block: 1499n, records: 2, legacy: false });
    expect(plain.head).toEqual({ block: 1499, timestamp: 1499 });
  });

  it("replayRound throws on a transcript mismatch and returns nothing", async () => {
    const { src, stateReads } = fakeSource({ head: 1499, transcript: `0x${"ab".repeat(32)}` });
    await expect(replayRound(manifest, src, { now: 1500, finalAfterSecs: 10 })).rejects
      .toMatchObject({ code: "transcript_mismatch" });
    // Checked before anything else is read.
    expect(stateReads).toEqual([]);
  });

  it("the raw withdrawn flags are served for the rules; live.withdrawn leaves a settled one out", async () => {
    const { src } = fakeSource({ head: 1499 });
    const read = src.stateAt;
    // a was funded when S-Tier settled at 1100; its flag is set after.
    src.stateAt = async (b) => ({ ...await read(b), withdrawn: b > 1200 ? [true] : [] });
    const st = await replayRound(manifest, src, { now: 1500, finalAfterSecs: 10 });
    const json = roundJson(st, manifest.slugs);
    expect(json.tiers[0]).toMatchObject({ status: "settled", funded: ["a"] });
    expect(json.withdrawnFlags).toEqual(["a"]);
    expect(json.live.withdrawn).toEqual([]);
  });

  it("a read error rejects the replay", async () => {
    const { src } = fakeSource({ head: 1499 });
    src.stateAt = () => Promise.reject(new Error("missing trie node"));
    await expect(replayRound(manifest, src, { now: 1500, finalAfterSecs: 10 })).rejects
      .toThrow("missing trie node");
  });
});

it("goal and account corrections preserve settled awards in fresh, cached and snapshot replay", async () => {
  const { src } = fakeSource({ head: 2199 });
  // The old account/goal funded a in S-Tier. Both now show a different ask after a
  // correction between tiers; historical eth_call still returns the old values.
  src.stateAt = (b) =>
    Promise.resolve({
      timestamp: b,
      asks: b < 1500 ? [150n, 150n, 150n] : [1n, 40n, 150n],
      poolUsd: 200n,
      withdrawn: [],
    });
  const opts = { now: 2200, finalAfterSecs: 10 };
  const plain = await replayRound(manifest, src, opts);
  const cache = memoryCache();
  const warm = await replayRound(manifest, src, { ...opts, cache });
  const again = await replayRound(manifest, src, {
    ...opts,
    cache,
    snapshots: warm.tiers.flatMap((t) => t.status === "settled" ? [t] : []),
  });
  for (const st of [plain, warm, again]) {
    expect(st.tiers[0]).toMatchObject({
      status: "settled",
      funded: [0],
      awards: new Map([[0, 150n]]),
    });
    expect(st.asks).toEqual([1n, 40n, 150n]);
    expect(roundJson(st, manifest.slugs)).toEqual(roundJson(plain, manifest.slugs));
  }
});
