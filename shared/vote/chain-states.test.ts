import { describe, expect, it } from "vitest";
import { chainStates, type StateCache, type StateSource } from "./chain-states";
import type { VoteManifest } from "./manifest";

const CONTRACT = "0x00000000000000000000000000000000000000C0";
const USD = "0x0000000000000000000000000000000000000000";
/** S-Tier windows end at 1400, 1600, 1700; A-Tier's at 2400…; B-Tier's at 3400…. */
const manifest = (currencies = true): VoteManifest => ({
  kind: "test",
  chainId: 11155111,
  contract: CONTRACT,
  deployBlock: 1,
  opensAt: 0,
  closesAt: 3700,
  schedule: { opensAt: 0, firstTallyAt: [1000, 2000, 3000], initialWindow: 400, maxWindows: 3 },
  poolUsd: "100",
  slugs: ["a", "b", "c"],
  projects: [0, 1, 2].map(() => ({ goalUsd: "10", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
  ...(currencies
    ? {
      currencies: [
        { symbol: "USD", asset: USD, usdFeed: USD },
        { symbol: "ETH", asset: USD, usdFeed: "0x00000000000000000000000000000000000000fe" },
      ],
      accounts: ["0x1", "0x2", "0x3"].map((a) => a.padEnd(42, "0") as `0x${string}`),
    }
    : {}),
});

/** One block a second: block b has timestamp b. */
function fakeChain(o: {
  head: number;
  finalized?: number;
  hashAt?: (b: number) => `0x${string}`;
  accounting?: number[];
  balances?: number[];
  asksAt?: (b: number) => bigint[];
  withdrawnAt?: (b: number) => boolean[];
  fail?: (b: number) => boolean;
  noBalances?: boolean;
}) {
  const reads: number[] = [];
  const scanned: [number, number][] = [];
  const searches: number[] = [];
  const scans = { inFlight: 0, most: 0 };
  const blockAt = (b: number) =>
    Promise.resolve({
      block: b,
      timestamp: b,
      hash: o.hashAt?.(b) ?? `0x${b.toString(16).padStart(64, "0")}` as `0x${string}`,
    });
  const src: StateSource = {
    blockAt,
    finalized: () => blockAt(o.finalized ?? o.head - 100),
    head: () => Promise.resolve({ block: o.head, timestamp: o.head }),
    blockBefore: (t) => {
      searches.push(t);
      const b = Math.min(o.head, t - 1);
      return Promise.resolve({ block: b, timestamp: b });
    },
    stateAt: (b) => {
      reads.push(b);
      if (o.fail?.(b)) return Promise.reject(new Error(`missing trie node at ${b}`));
      return Promise.resolve({
        timestamp: b,
        asks: o.asksAt?.(b) ?? [1n, 2n, 3n],
        poolUsd: 100n,
        poolInitialized: true,
        withdrawn: o.withdrawnAt?.(b) ?? [],
      });
    },
    accountingEventBlocks: (from, to) =>
      Promise.resolve((o.accounting ?? []).filter((b) => b >= from && b <= to)),
    balanceChangeBlocks: async (from, to) => {
      if (o.noBalances) throw new Error("balances scanned");
      scanned.push([from, to]);
      scans.most = Math.max(scans.most, ++scans.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      scans.inFlight--;
      return (o.balances ?? []).filter((b) => b >= from && b <= to);
    },
  };
  return { src, reads, scanned, searches, scans };
}
const memoryCache = () => {
  const map = new Map<string, unknown>();
  const cache: StateCache = {
    get: (k) => Promise.resolve(map.get(k)),
    set: (k, v) => Promise.resolve(void map.set(k, structuredClone(v))),
  };
  return { cache, map };
};
const opts = (now: number, receiptBlocks: number[] = []) => ({
  now,
  receiptBlocks,
});
const blocks = (xs: { block: number }[]) => xs.map((x) => x.block);
const events = (xs: { block: number; event: boolean }[]) =>
  xs.filter((x) => x.event).map((x) => x.block);

describe("chainStates", () => {
  it("each state carries the withdrawn flags; an InitiativeWithdrawn block is an event", async () => {
    const { src } = fakeChain({
      head: 1649,
      accounting: [1300, 1500],
      withdrawnAt: (b) => (b >= 1500 ? [false, true] : []),
    });
    const out = await chainStates(manifest(false), src, opts(1650));
    expect(out.find((x) => x.block === 1300)).toMatchObject({ withdrawn: [], event: true });
    expect(out.find((x) => x.block === 1500)).toMatchObject({
      withdrawn: [false, true],
      event: true,
    });
    expect(out.at(-1)?.withdrawn).toEqual([false, true]);
  });

  it("a cached state stored under the old key shape is not used", async () => {
    const { cache, map } = memoryCache();
    map.set(`state:${CONTRACT}:1649`, { timestamp: 1649, asks: ["9"], poolUsd: "9" });
    const { src, reads } = fakeChain({ head: 1649, withdrawnAt: () => [true] });
    const out = await chainStates(manifest(false), src, { ...opts(1650), cache });
    expect(reads).toContain(1649);
    expect(out.at(-1)).toMatchObject({ asks: [1n, 2n, 3n], withdrawn: [true] });
  });

  it("a state for each boundary, each event block and the head", async () => {
    const { src } = fakeChain({ head: 1649, accounting: [900, 1300], balances: [1450] });
    const out = await chainStates(manifest(), src, opts(1650, [500, 1200, 1500]));
    // Before S-Tier's first tally (999), before the passed cutoffs 1400 and 1600 (1399,
    // 1599), the receipts and events inside the span, and the head. Nothing outside it.
    expect(blocks(out)).toEqual([999, 1200, 1300, 1399, 1450, 1500, 1599, 1649]);
    expect(out.every((x, i) => i === 0 || x.block > out[i - 1].block)).toBe(true);
  });

  it("a ballot past the node's head is refused, not judged with an older state", async () => {
    const { src } = fakeChain({ head: 1649 });
    await expect(chainStates(manifest(), src, opts(1700, [1200, 1660]))).rejects.toThrow(
      /behind a ballot at 1660/,
    );
  });

  it("a head older than a passed cutoff is refused: the blocks before it are unseen", async () => {
    // S-Tier's first window ended at 1400; the node's head is at 1350, long after.
    const { src } = fakeChain({ head: 1350, accounting: [1300] });
    await expect(chainStates(manifest(), src, opts(1450, [1200]))).rejects.toThrow(
      /head at 1350 is behind the tally time 1400/,
    );
    // Likewise a tier's first tally.
    const early = fakeChain({ head: 950 });
    await expect(chainStates(manifest(), early.src, opts(1100))).rejects.toThrow(
      /behind the tally time 1000/,
    );
  });

  it("just after a cutoff, a head not yet past it stands in for the block before it", async () => {
    // 10 s after the cutoff at 1400 the next block may not be there yet.
    const { src } = fakeChain({ head: 1395 });
    const out = await chainStates(manifest(), src, opts(1410));
    expect(blocks(out)).toEqual([999, 1395]);
  });

  it("before the first tally, only the head", async () => {
    const { src } = fakeChain({ head: 500, accounting: [400] });
    const out = await chainStates(manifest(), src, opts(501, [450]));
    expect(blocks(out)).toEqual([500]);
  });

  it("the head is the last block before now, not one at or after it", async () => {
    const { src } = fakeChain({ head: 1700 });
    const out = await chainStates(manifest(), src, opts(1650));
    expect(blocks(out).at(-1)).toBe(1649);
  });

  it("a pledge or pool change marks its block as an event; a receipt block alone is not one", async () => {
    const { src } = fakeChain({ head: 1649, accounting: [1300, 1500] });
    const out = await chainStates(manifest(false), src, opts(1650, [1200, 1500]));
    expect(events(out)).toEqual([1300, 1500]);
    expect(out.find((x) => x.block === 1200)?.event).toBe(false);
  });

  it("a balance change marks its block as an event", async () => {
    const { src } = fakeChain({ head: 1649, balances: [1450] });
    const out = await chainStates(manifest(), src, opts(1650));
    expect(events(out)).toEqual([1450]);
  });

  it("a round without currencies never scans balances", async () => {
    const { src } = fakeChain({ head: 2650, accounting: [1300], noBalances: true });
    const out = await chainStates(manifest(false), src, opts(2650));
    expect(events(out)).toEqual([1300]);
    const onlyUsd = { ...manifest(), currencies: manifest().currencies!.slice(0, 1) };
    await expect(chainStates(onlyUsd, src, opts(2650))).resolves.toBeTruthy();
  });

  it("each started tier's span is read, up to now", async () => {
    const { src, scanned } = fakeChain({ head: 2499, balances: [1100, 1800, 2100] });
    const out = await chainStates(manifest(), src, opts(2500));
    // S-Tier's span is [1000, 1700), A-Tier's [2000, 2500): 1800 is in neither.
    expect(events(out)).toEqual([1100, 2100]);
    expect(scanned.every(([f, t]) => (f >= 1000 && t <= 1699) || (f >= 2000 && t <= 2499)))
      .toBe(true);
  });

  it("a project added later is missing from earlier states", async () => {
    const { src } = fakeChain({
      head: 1649,
      accounting: [1300],
      asksAt: (b) => (b < 1300 ? [5n, 6n] : [5n, 6n, 7n]),
    });
    const out = await chainStates(manifest(), src, opts(1650));
    expect(out.map((x) => x.asks.length)).toEqual([2, 3, 3, 3, 3]);
    expect(out[0].asks).toEqual([5n, 6n]);
  });

  it("a read error fails the whole call", async () => {
    const { src } = fakeChain({ head: 1649, fail: (b) => b === 1399 });
    await expect(chainStates(manifest(), src, opts(1650))).rejects.toThrow(/missing trie node/);
    const bad = fakeChain({ head: 1649 }).src;
    bad.accountingEventBlocks = () => Promise.reject(new Error("logs unavailable"));
    await expect(chainStates(manifest(), bad, opts(1650))).rejects.toThrow(/logs unavailable/);
  });

  it("a final block is read once; a recent block is read again", async () => {
    const { cache, map } = memoryCache();
    const { src, reads, scanned } = fakeChain({
      head: 1649,
      accounting: [1300],
      balances: [1450, 1590],
    });
    const o = { ...opts(1650, [1200, 1560]), cache };
    const first = await chainStates(manifest(), src, o);
    reads.length = 0;
    scanned.length = 0;
    const second = await chainStates(manifest(), src, o);
    expect(second).toEqual(first);
    // Final: older than now − 100 s = 1550. 1560, 1590, 1599 and the head are not.
    expect(reads.sort((a, b) => a - b)).toEqual([1560, 1590, 1599, 1649]);
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every(([from]) => from >= 1550)).toBe(true);
    expect([...map.keys()].some((k) => k.startsWith("state:") && k.includes("0x"))).toBe(true);
  });

  it("a scan that moves on with time reads only the new blocks", async () => {
    const { cache } = memoryCache();
    const { src, scanned } = fakeChain({ head: 1300, balances: [1100, 1250] });
    await chainStates(manifest(), src, { ...opts(1301), cache });
    scanned.length = 0;
    const later = fakeChain({ head: 1500, balances: [1100, 1250, 1450] });
    const out = await chainStates(manifest(), later.src, { ...opts(1501), cache });
    expect(events(out)).toEqual([1100, 1250, 1450]);
    // Final at the first call: blocks before 1201, so before 1200 on the 300 s line.
    expect(later.scanned.every(([from]) => from >= 1200)).toBe(true);
  });

  it("elapsed time never promotes unfinalized states into the persistent cache", async () => {
    const { cache, map } = memoryCache();
    const { src, reads } = fakeChain({ head: 1719, finalized: 900 });
    await chainStates(manifest(), src, { ...opts(1720), cache });
    reads.length = 0;
    await chainStates(manifest(), src, { ...opts(1720), cache });
    expect(reads).toContain(1399);
    expect([...map.keys()].filter((k) => k.startsWith("state:"))).toEqual([]);
  });

  it("a reorganization with unchanged configuration invalidates state and balance caches", async () => {
    const { cache } = memoryCache();
    const old = fakeChain({ head: 1719, finalized: 1600, balances: [1300], asksAt: () => [1n] });
    await chainStates(manifest(), old.src, { ...opts(1720), cache });
    const next = fakeChain({
      head: 1719,
      finalized: 1600,
      balances: [1350],
      asksAt: () => [9n],
      hashAt: (b) => `0x${(b + 10000).toString(16).padStart(64, "0")}`,
    });
    const result = await chainStates(manifest(), next.src, { ...opts(1720), cache });
    expect(result.every((s) => s.asks[0] === 9n)).toBe(true);
    expect(events(result)).toContain(1350);
    expect(events(result)).not.toContain(1300);
  });

  it("a reorganization during a historical state read aborts replay", async () => {
    const { src } = fakeChain({ head: 1719 });
    const read = src.blockAt!;
    src.finalized = undefined;
    let changed = false;
    const stateAt = src.stateAt;
    src.stateAt = async (b) => {
      const state = await stateAt(b);
      changed = true;
      return state;
    };
    src.blockAt = async (b) => ({ ...await read(b), hash: changed ? "0xdead" : "0xbeef" });
    await expect(chainStates(manifest(false), src, opts(1720))).rejects.toThrow(/changed during/);
  });

  it("cache read and write failures do not prevent a chain-derived result", async () => {
    const { src } = fakeChain({ head: 1719 });
    const broken: StateCache = {
      get: () => Promise.reject(new Error("KV down")),
      set: () => Promise.reject(new Error("KV full")),
    };
    const plain = await chainStates(manifest(false), src, opts(1720));
    expect(await chainStates(manifest(false), src, { ...opts(1720), cache: broken })).toEqual(
      plain,
    );
  });

  it("a malformed cached input is discarded and read from the chain again", async () => {
    const { src, reads } = fakeChain({ head: 1719 });
    const { cache, map } = memoryCache();
    await chainStates(manifest(false), src, { ...opts(1720), cache });
    for (const key of map.keys()) {
      if (key.startsWith("state:")) map.set(key, { timestamp: 1399, asks: ["bad"] });
    }
    reads.length = 0;
    const result = await chainStates(manifest(false), src, { ...opts(1720), cache });
    expect(reads).toContain(1399);
    expect(result.every((s) => s.asks[0] === 1n)).toBe(true);
  });

  it("balance scans run one at a time", async () => {
    const { src, scans } = fakeChain({ head: 2499 });
    await chainStates(manifest(), src, opts(2500));
    expect(scans.most).toBe(1);
  });
});
