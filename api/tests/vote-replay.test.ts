// scripts/vote-replay.ts against the site: the same fake chain must give the same round.
// (Here, not in scripts/: `deno task test:api` runs api/ only.)
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { type Hex, zeroHash } from "viem";
import { harness, j } from "./app-helpers.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { type BallotEvent, type RoundSource } from "../../shared/vote/replay-round.ts";
import { transcriptOf } from "../../shared/vote/transcript.ts";
import type { VoteChain } from "../services/vote-chain.ts";
import { main } from "../../scripts/vote-replay.ts";

const NOW = 1_800_000_000;
const VOTER: Hex = "0x1563915e194D8CfBA1943570603F7606A3115508";
/** S-Tier settles at NOW − 400 (a quiet window); A-Tier is settling at NOW. */
const manifest: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: NOW - 3600,
  closesAt: NOW + 3600,
  schedule: {
    opensAt: NOW - 3600,
    firstTallyAt: [NOW - 500, NOW - 100, NOW + 1000],
    initialWindow: 100,
    maxWindows: 2,
  },
  poolUsd: "300",
  slugs: ["a", "b", "c"],
  projects: ["a", "b", "c"].map(() => ({ goalUsd: "150", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};

/** One block a second from NOW − 3600 (block 1), a $300 pool ($100 a badge). Badges 1 and
 * 2 rank a in S-Tier, badge 3
 * ranks b in S-Tier and c in A-Tier; a donation lowers c's ask inside A-Tier's window. The
 * reads from S-Tier's first tally (block 3100) on fail with `failAt`. */
function fakeSource(o: { failAt?: number; now?: number } = {}): RoundSource {
  const t0 = NOW - 3601;
  const blockOf = (t: number) => t - t0;
  const head = blockOf((o.now ?? NOW) - 1);
  const ev = (tokenId: string, ballot: Hex, t: number): BallotEvent => ({
    tokenId,
    ballot,
    voter: VOTER,
    nonce: 1,
    timestamp: t,
    block: blockOf(t),
    logIndex: 0,
  });
  const events = [
    ev("1", "0x01ffff", NOW - 1000),
    ev("2", "0x01ffff", NOW - 900),
    ev("3", "0xff0102", NOW - 800),
  ];
  const donation = blockOf(NOW - 50);
  return {
    head: () => Promise.resolve({ block: head, timestamp: head + t0 }),
    blockBefore: (t) => {
      const b = Math.min(head, blockOf(t) - 1);
      return Promise.resolve({ block: b, timestamp: b + t0 });
    },
    stateAt: (b) => {
      if (o.failAt !== undefined && b <= o.failAt) {
        return Promise.reject(
          new Error(`missing trie node at ${b}\n\nURL: https://archive.example/v2/SECRETKEY`),
        );
      }
      return Promise.resolve({
        timestamp: b + t0,
        asks: [150n, 150n, b >= donation ? 40n : 150n],
        withdrawn: [],
        poolUsd: 300n,
      });
    },
    accountingEventBlocks: (from, to) =>
      Promise.resolve(donation >= from && donation <= to ? [donation] : []),
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

async function manifestFile(): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(path, JSON.stringify(manifest));
  return path;
}

async function runScript(args: string[], source: RoundSource) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    source,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

Deno.test("the script and the API agree on the same fake chain", async () => {
  const source = fakeSource();
  const h = await harness();
  const { ballots, committed, rulesHistory } = source;
  // The site reads ballots through its VoteChain and states through its StateSource.
  h.deps.vote = {
    chain: { ballots, committed, rulesHistory } as unknown as VoteChain,
    manifest,
    source,
  };
  h.clock.now = NOW;
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 200);
  const api = await j(res) as Record<string, unknown> & { live: Record<string, unknown> };
  await h.settle();
  h.close();
  // What the site adds on top of the replay: its what-if searches.
  const { next: _n, threat: _t, give: _g, ...live } = api.live;
  const { final: _f, ...rest } = api;
  const fromApi = { ...rest, live };

  const path = await manifestFile();
  const run = await runScript(["--manifest", path, "--at", String(NOW), "--json"], source);
  assertEquals([run.code, run.err], [0, ""]);
  const script = JSON.parse(run.out);
  assertEquals(script.round, fromApi);
  assertEquals((script.round.tiers as { status: string }[]).map((t) => t.status), [
    "settled",
    "settling",
    "waiting",
  ]);
  assertEquals(script.transcript.records, 3);
  assertEquals(script.transcript.legacy, false);

  // The text report: each tier, its funded projects in dollars, and the checks.
  const text = await runScript(["--manifest", path, "--at", String(NOW)], source);
  assertEquals(text.code, 0);
  assertStringIncludes(text.out, "S-Tier: settled");
  assertStringIncludes(text.out, "A-Tier: settling");
  assertStringIncludes(text.out, "B-Tier: waiting");
  assertStringIncludes(text.out, "a $0.00015");
  assertStringIncludes(text.out, "Transcript: matches the contract");
  await Deno.remove(path);
});

Deno.test("the script and API agree despite an incorrect stored settlement", async () => {
  // The API and script both reconstruct historical settlements; obsolete saved
  // awards cannot override that reconstruction.
  const at = NOW - 400 + 1860;
  const source = fakeSource({ now: at + 60 });
  const h = await harness();
  const { committed, rulesHistory } = source;
  let replays = 0;
  const ballots = () => (replays++, source.ballots());
  h.deps.vote = {
    chain: { ballots, committed, rulesHistory } as unknown as VoteChain,
    manifest,
    source,
  };
  const key = ["vote", manifest.contract.toLowerCase()];
  h.clock.now = at;
  assertEquals((await h.req("/api/vote/round")).status, 200);
  assertEquals((await h.deps.db.kv.get([...key, "settled-w1", "S"])).value, null);
  await h.deps.db.kv.set([...key, "settled-w1", "S"], {
    tier: "S",
    at: at,
    funded: [],
    awards: [],
    shares: [],
    covered: [],
    withdrawn: [],
  });
  // A minute on, the API recomputes despite an incorrect saved record.
  await h.deps.db.kv.delete([...key, "round"]);
  h.clock.now = at + 60;
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 200);
  assertEquals(replays, 2, "the second request replayed");
  const api = await j(res) as Record<string, unknown> & { live: Record<string, unknown> };
  await h.settle();
  h.close();
  const { next: _n, threat: _t, give: _g, ...live } = api.live;
  const { final: _f, ...rest } = api;

  const path = await manifestFile();
  const run = await runScript(["--manifest", path, "--at", String(at + 60), "--json"], source);
  assertEquals([run.code, run.err], [0, ""]);
  const script = JSON.parse(run.out);
  assertEquals(script.round, { ...rest, live });
  assertEquals((script.round.tiers as { status: string }[])[0].status, "settled");
  await Deno.remove(path);
});

Deno.test("the script exits non-zero when a past block cannot be read", async () => {
  const path = await manifestFile();
  const run = await runScript(
    ["--manifest", path, "--at", String(NOW)],
    fakeSource({ failAt: 3100 }),
  );
  assertEquals(run.code, 1);
  assertEquals(run.out, "");
  assertStringIncludes(run.err, "missing trie node");
  // The RPC URL may carry an API key: never printed.
  assert(!run.err.includes("SECRETKEY"), run.err);
  assertStringIncludes(run.err, "<rpc>");
  await Deno.remove(path);
});

Deno.test("the script needs an archive RPC", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([], { out: (s) => out.push(s), err: (s) => err.push(s) });
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "--rpc");
});

Deno.test("wallet and goal corrections reproduce settled awards in the API, cached replay and CLI", async () => {
  const at = NOW + 2000;
  const source = fakeSource({ now: at + 100 });
  const original = source.stateAt;
  source.stateAt = async (b) => {
    const state = await original(b);
    // A correction in the gap after S-Tier: a's current ask changes, but its
    // historical goal/account at S-Tier's cutoff still produces its $150 award.
    return {
      ...state,
      asks: state.timestamp >= NOW - 300 ? [1n, 150n, state.asks[2]] : state.asks,
    };
  };
  const m = {
    ...manifest,
    configRevision: "2",
    projects: manifest.projects.map((p, i) => i === 0 ? { ...p, goalUsd: "1" } : p),
  };
  const h = await harness();
  h.deps.vote = {
    manifest: m,
    source,
    chain: {
      ballots: source.ballots,
      committed: source.committed,
      rulesHistory: source.rulesHistory,
    } as VoteChain,
  };
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(path, JSON.stringify(m));
    for (const now of [at, at + 60]) {
      h.clock.now = now;
      const res = await h.req("/api/vote/round");
      assertEquals(res.status, 200);
      const result = await j(res) as Record<string, unknown> & { live: Record<string, unknown> };
      const { next: _n, lead: _l, give: _g, ...live } = result.live;
      const { final: _f, ...rest } = result;
      const script = await runScript(["--manifest", path, "--at", String(now), "--json"], source);
      assertEquals([script.code, script.err], [0, ""]);
      const expected = JSON.parse(script.out).round;
      assertEquals({ ...rest, live }, expected);
      assertEquals(expected.tiers[0].awards.a, "150");
      await h.settle();
      await h.deps.db.kv.delete([
        "vote",
        m.contract.toLowerCase(),
        "corrections1",
        m.chainId,
        "2",
        "round",
      ]);
    }
  } finally {
    await Deno.remove(path);
    await h.settle();
    h.close();
  }
});
