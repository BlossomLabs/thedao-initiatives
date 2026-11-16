import { assertEquals } from "@std/assert";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex, type Hex, parseSignature, signatureToCompactSignature, zeroHash } from "viem";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { encodeBallot } from "../../shared/vote/ballot.ts";
import { voteTypedData } from "../../shared/vote/typed-data.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { type TranscriptEvent, transcriptOf } from "../../shared/vote/transcript.ts";
import type { BallotEvent, VoteChain } from "../services/vote-chain.ts";
import { cacheSet, errorText, voteSearches } from "../routes/vote.ts";
import { chainTally } from "../../shared/vote/chain.ts";
import { liveInputsFrom, type LiveInputsJson } from "../../shared/vote/live-inputs.ts";
import type { ChainState } from "../../shared/vote/quiet-ending.ts";
import { decodeFunctionData } from "viem";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";

// PLAIN's key (app-helpers: wallet("0x22..22")).
const VOTER = privateKeyToAccount(`0x${"22".repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${"33".repeat(32)}`);
const NOW = 1_800_000_000;

const manifest: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: NOW - 3600,
  closesAt: NOW + 3600,
  schedule: {
    opensAt: NOW - 3600,
    firstTallyAt: [NOW + 600, NOW + 660, NOW + 720],
    initialWindow: 60,
    maxWindows: 1,
  },
  poolUsd: "913244000000",
  slugs: ["a", "b", "c"],
  projects: ["a", "b", "c"].map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};

const RELAYER = "0x9000000000000000000000000000000000000009" as const;
const BADGE = "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C" as const;
const real: VoteManifest = {
  kind: "real",
  chainId: 1,
  contract: "0x1000000000000000000000000000000000000001",
  badge: BADGE,
  deployBlock: 1,
  opensAt: NOW - 3600,
  closesAt: NOW + 3600,
  schedule: manifest.schedule,
  poolUsd: "913244000000",
  slugs: ["a", "b", "c"],
  projects: ["a", "b", "c"].map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};

type Sent = Parameters<VoteChain["send"]>[0];

function fakeChain(chainManifest: VoteManifest = manifest) {
  const state = {
    /** What the next send throws (a contract revert the RPC reports). */
    sendError: null as Error | null,
    /** Projects added and pool changes on-chain (the ballot rules judge by them). */
    history: {
      addedAt: [] as ({ block: number; logIndex: number } | null)[],
      pool: [] as { block: number; logIndex: number; poolUsd: bigint }[],
    },
    owners: new Map<bigint, Hex>(),
    nonces: new Map<bigint, bigint>(),
    /** Account code by lowercase address ("0xef0100…" = an EIP-7702 delegation). */
    code: new Map<string, Hex>(),
    /** Addresses whose wallet code would make _safeMint revert. */
    unmintable: new Set<string>(),
    balances: new Map<string, bigint>(),
    sent: [] as Sent[],
    slowSend: null as null | Promise<void>,
    /** false: mints stay pending (not visible to ownerOf/balanceOf). */
    mintsMine: true,
    /** What the chain emitted; a ballot without a voter or nonce gets PLAIN and the
     * token's next nonce when read. */
    logs: [] as ({
      tokenId: string;
      ballot: Hex;
      timestamp: number;
      block?: number;
      logIndex?: number;
      voter?: Hex;
      nonce?: number;
    } | {
      tokenId: string;
      revoked: true;
      timestamp: number;
      block?: number;
    })[],
    /** What the contract's transcript says instead of the true one (a ballot it never saw). */
    transcriptOverride: null as Hex | null,
    /** The contract hashes entries the pre-Nov 14 way. */
    legacyTranscript: false,
    /** Likewise for the record count and one token's ballot hash. */
    countOverride: null as bigint | null,
    hashOverride: null as { tokenId: string; hash: Hex } | null,
    /** What each project asks on-chain; "fail": the read fails. Default: its goal. */
    asks: null as bigint[] | null | "fail",
    /** The chain states the round reads, when a test sets them; else one state with
     * `asks` and the pool. */
    states: null as ChainState[] | null,
    /** The node's head time, when a test has it lag; else a second before now. */
    headAt: null as number | null,
    stateReads: 0,
    ballotReads: 0,
    txStatus: new Map<string, "pending" | "success" | "reverted" | "unknown">(),
    /** What the RPC says the relayer's pending nonce is (may lag). */
    chainNonce: 0,
    nonces_used: [] as number[],
    /** Voting-badge ids per lowercase address (the real round's index lookup). */
    badges: new Map<string, number[]>(),
  };
  const fullEvents = () => {
    const nonces = new Map<string, number>();
    return state.logs.map((l): BallotEvent => {
      if ("revoked" in l) return l;
      const nonce = l.nonce ?? (nonces.get(l.tokenId) ?? 0) + 1;
      nonces.set(l.tokenId, nonce);
      return { ...l, voter: l.voter ?? PLAIN, nonce };
    });
  };
  const chain: VoteChain = {
    ownerOf: (n) => Promise.resolve(state.owners.get(n) ?? null),
    balanceOf: (a) =>
      Promise.resolve(
        BigInt(
          [...state.owners.values()].filter((o) => o.toLowerCase() === a.toLowerCase()).length,
        ),
      ),
    idsOf: (a) =>
      Promise.resolve(
        state.badges.get(a.toLowerCase()) ??
          [...state.owners].filter(([, o]) => o.toLowerCase() === a.toLowerCase())
            .map(([n]) => Number(n)),
      ),
    relayerAddress: () => RELAYER,
    badgeOf: (a) =>
      Promise.resolve(
        [...state.owners].find(([, o]) => o.toLowerCase() === a.toLowerCase())?.[0] ?? null,
      ),
    codeOf: (a) => Promise.resolve(state.code.get(a.toLowerCase()) ?? "0x"),
    canMint: (to) => Promise.resolve(!state.unmintable.has(to.toLowerCase())),
    nonceOf: (n) => Promise.resolve(state.nonces.get(n) ?? 0n),
    pledgeNonceOf: () => Promise.resolve(0n),
    blockNumber: () => Promise.resolve(100n),
    pledgeOf: () =>
      Promise.resolve({ initiativeId: 0n, currencyId: 0n, amount: 0n, exists: false }),
    balance: (a) => Promise.resolve(state.balances.get(a.toLowerCase()) ?? 0n),
    txStatus: (hash) => Promise.resolve(state.txStatus.get(hash) ?? "pending"),
    estimateRecordFor: () => Promise.resolve(100_000n * 2_000_000_000n),
    relayerNonce: () => Promise.resolve(state.chainNonce),
    async send(call, nonce) {
      if (state.slowSend) await state.slowSend;
      if (state.sendError) throw state.sendError;
      state.sent.push(call);
      state.nonces_used.push(nonce);
      if (call.fn === "mint" && state.mintsMine) {
        state.owners.set(call.args[1] as bigint, call.args[0] as Hex);
      }
      return `0x${state.sent.length.toString(16).padStart(64, "0")}` as Hex;
    },
    ballots: () => {
      state.ballotReads++;
      return Promise.resolve({ events: fullEvents(), block: 100n });
    },
    committed: (block, tokenIds) => {
      if (block !== 100n) throw new Error(`committed read at ${block}, not the ballots' block`);
      const t = transcriptOf(
        fullEvents().map((e): TranscriptEvent =>
          "revoked" in e
            ? e
            : { tokenId: e.tokenId, voter: e.voter, nonce: BigInt(e.nonce), ballot: e.ballot }
        ),
        state.legacyTranscript,
      );
      return Promise.resolve({
        transcript: state.transcriptOverride ?? t.transcript,
        recordCount: state.countOverride ?? BigInt(t.count),
        hashes: tokenIds.map((id) =>
          state.hashOverride?.tokenId === id.toString()
            ? state.hashOverride.hash
            : t.lastHash.get(id.toString()) ?? zeroHash
        ),
      });
    },
    rulesHistory: () => Promise.resolve(state.history),
    asks: () =>
      state.asks === "fail"
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(state.asks ?? chainManifest.projects.map((p) => BigInt(p.goalUsd))),
  };
  /** The round's chain states: the test's own, or one state for the whole round, up to
   * the node's head (`headAt`, default a second before `now`); then the head itself, as
   * chainStates() always reads it: the last state's values again. */
  const states = (now: number): Promise<ChainState[]> => {
    state.stateReads++;
    if (state.asks === "fail") return Promise.reject(new Error("missing trie node"));
    const headAt = state.headAt ?? now - 1;
    const xs = (state.states ?? oneState(
      state.asks ?? chainManifest.projects.map((p) => BigInt(p.goalUsd)),
      state.history.pool.at(-1)?.poolUsd ?? BigInt(chainManifest.poolUsd),
    )).filter((x) => x.timestamp <= headAt);
    const last = xs.at(-1);
    if (last && last.timestamp < headAt) {
      xs.push({ ...last, block: last.block + 1_000_000, timestamp: headAt, event: false });
    }
    return Promise.resolve(xs);
  };
  return { state, chain, states };
}

/** The asks and pool at one block. */
const stateAt = (
  block: number,
  timestamp: number,
  asks: bigint[],
  poolUsd: bigint,
  event = true,
): ChainState => ({ block, timestamp, asks, poolUsd, withdrawn: [], event });
/** One chain state for the whole round, as at block 0. */
const oneState = (asks: bigint[], poolUsd: bigint) => [stateAt(0, 0, asks, poolUsd, false)];
/** One state for the whole round and the node's head a second before now, as
 * chainStates() reads them (it always ends with the head). */
const withHead = (asks: bigint[], poolUsd: bigint) => [
  ...oneState(asks, poolUsd),
  stateAt(1_000_000, NOW - 1, asks, poolUsd, false),
];

async function setup(m: VoteManifest = manifest) {
  const h = await harness();
  const fake = fakeChain(m);
  // The relayer has gas unless a test says otherwise.
  fake.state.balances.set(RELAYER, 10n ** 18n);
  // Every initiative asks its goal unless a test says otherwise (the board isn't seeded).
  h.deps.vote = { chain: fake.chain, manifest: m, states: fake.states };
  h.clock.now = NOW;
  return { h, ...fake };
}

/** Admin → Vote's "give a badge", by an admin with a recent sign-in. */
async function give(h: Awaited<ReturnType<typeof harness>>, to: string) {
  return await h.req("/api/admin/vote-round/badge", {
    method: "POST",
    token: await h.mint(ADMIN, true),
    json: { address: to },
  });
}

async function signedBallot(
  signer: typeof VOTER,
  tokenId: bigint,
  nonce: bigint,
  ballot: Hex,
  m: VoteManifest = manifest,
) {
  const signature = await signer.signTypedData(
    voteTypedData(m, tokenId, VOTER.address, nonce, ballot),
  );
  return { tokenId: tokenId.toString(), nonce: nonce.toString(), ballot, signature };
}

const BALLOT = bytesToHex(encodeBallot(manifest.slugs, { a: "S", c: "A" }));

Deno.test("vote round mine: the signed-in account's badges, or none; needs a session", async () => {
  const { h, state } = await setup();
  assertEquals((await h.req("/api/vote/mine")).status, 401);
  const token = await h.mint(PLAIN);
  assertEquals(await j(await h.req("/api/vote/mine", { token })), { ids: [] });
  state.owners.set(17n, PLAIN);
  assertEquals(await j(await h.req("/api/vote/mine", { token })), { ids: [17] });
  h.close();
});

Deno.test("real round mine: every voting badge the account holds, in order", async () => {
  const { h, state } = await setup(real);
  state.badges.set(PLAIN.toLowerCase(), [40, 12]);
  const token = await h.mint(PLAIN);
  assertEquals(await j(await h.req("/api/vote/mine", { token })), { ids: [12, 40] });
  h.close();
});

Deno.test("real round: no test badges, ETH or TestUSD from admins, no gas drip", async () => {
  const { h, state } = await setup(real);
  const token = await h.mint(PLAIN);
  state.owners.set(17n, PLAIN);
  const gas = await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } });
  assertEquals([gas.status, (await j(gas)).code], [404, "off"]);
  for (
    const [path, json] of [
      ["badge", { address: OTHER.address }],
      ["eth", { address: OTHER.address, eth: 0.01 }],
      ["test-usd", { address: OTHER.address, usd: 100 }],
    ] as const
  ) {
    const res = await h.req(`/api/admin/vote-round/${path}`, {
      method: "POST",
      token: await h.mint(ADMIN, true),
      json,
    });
    assertEquals(res.status, 409, path);
  }
  assertEquals(state.sent.length, 0);
  h.close();
});

Deno.test("real round ballot: the badge's owner votes; another wallet's signature is refused", async () => {
  const { h, state } = await setup(real);
  state.owners.set(12n, VOTER.address);
  const ok = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 12n, 1n, BALLOT, real),
  });
  assertEquals(ok.status, 200);
  const bad = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(OTHER, 12n, 1n, BALLOT, real),
  });
  assertEquals([bad.status, (await j(bad)).code], [401, "bad_signature"]);
  h.close();
});

Deno.test("real round ballot: the relay pays for at most 5 ballots per badge", async () => {
  const { h, state } = await setup(real);
  state.owners.set(12n, VOTER.address);
  for (let i = 1; i <= 5; i++) {
    const res = await h.req("/api/vote/ballot", {
      method: "POST",
      json: await signedBallot(VOTER, 12n, BigInt(i), BALLOT, real),
    });
    assertEquals(res.status, 200, `relay ${i}`);
    state.nonces.set(12n, BigInt(i));
  }
  const over = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 12n, 6n, BALLOT, real),
  });
  assertEquals([over.status, (await j(over)).code], [429, "relay_limit"]);
  h.close();
});

Deno.test("real round ballot: a relayer low on gas says to send it yourself", async () => {
  const { h, state } = await setup(real);
  state.owners.set(12n, VOTER.address);
  state.balances.set(RELAYER, 0n);
  const res = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 12n, 1n, BALLOT, real),
  });
  assertEquals([res.status, (await j(res)).code], [503, "relay_low"]);
  assertEquals(state.sent.length, 0);
  h.close();
});

Deno.test("vote relayer: admins see its address and balance; nobody else", async () => {
  const { h } = await setup(real);
  assertEquals((await h.req("/api/vote/relayer", { token: await h.mint(PLAIN) })).status, 403);
  const res = await h.req("/api/vote/relayer", { token: await h.mint(ADMIN, true) });
  assertEquals(await j(res), { address: RELAYER, balanceWei: (10n ** 18n).toString(), chainId: 1 });
  h.close();
});

Deno.test("admin badge: mints the next free badge to the address; admins only", async () => {
  const { h, state } = await setup();
  assertEquals(
    (await h.req("/api/admin/vote-round/badge", {
      method: "POST",
      token: await h.mint(PLAIN),
      json: { address: PLAIN },
    })).status,
    403,
  );
  state.owners.set(1n, OTHER.address);
  const res = await give(h, PLAIN);
  assertEquals(res.status, 200);
  const body = await j(res);
  assertEquals([typeof body.hash, body.tokenId], ["string", 2]);
  assertEquals(state.sent, [{ fn: "mint", args: [PLAIN, 2n] }]);
  h.close();
});

Deno.test("admin badge: refusals", async () => {
  const { h, state } = await setup();
  const status = async (to: string) => (await give(h, to)).status;
  assertEquals(await status("nope"), 400);
  state.owners.set(18n, PLAIN);
  assertEquals(await status(PLAIN), 409);
  state.owners.delete(18n);
  state.code.set(PLAIN.toLowerCase(), "0x6080604052");
  assertEquals(await status(PLAIN), 422);
  state.code.clear();
  h.clock.now = manifest.closesAt;
  assertEquals(await status(PLAIN), 410);
  assertEquals(state.sent, []);
  h.close();
});

Deno.test("vote round ballot: relays record() with the signature as r and vs (plain ECDSA)", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, BALLOT);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 200);
  const { r, yParityAndS } = signatureToCompactSignature(parseSignature(body.signature));
  assertEquals(state.sent, [{
    fn: "record",
    args: [[{ tokenId: 17n, nonce: 1n, r, vs: yParityAndS, ballot: BALLOT, proof: [] }]],
  }]);
  h.close();
});

Deno.test("admin badge: an EIP-7702 wallet gets one; one whose delegate can't take it doesn't", async () => {
  const { h, state } = await setup();
  state.code.set(PLAIN.toLowerCase(), `0xef0100${"ab".repeat(20)}`);
  assertEquals((await give(h, PLAIN)).status, 200);
  state.code.set(OTHER.address.toLowerCase(), `0xef0100${"ab".repeat(20)}`);
  state.unmintable.add(OTHER.address.toLowerCase());
  assertEquals((await give(h, OTHER.address)).status, 422);
  assertEquals(state.sent.length, 1);
  h.close();
});

Deno.test("admin ETH and TestUSD: sent by the relayer to the address, within limits", async () => {
  const tusd = "0x5000000000000000000000000000000000000005" as const;
  const zero = "0x0000000000000000000000000000000000000000" as const;
  const { h, state } = await setup({
    ...manifest,
    currencies: [
      { symbol: "USD", asset: zero, usdFeed: zero },
      { symbol: "tUSD", asset: tusd, usdFeed: zero },
    ],
  });
  const send = async (path: string, json: unknown) =>
    (await h.req(`/api/admin/vote-round/${path}`, {
      method: "POST",
      token: await h.mint(ADMIN, true),
      json,
    })).status;
  assertEquals(await send("eth", { address: PLAIN, eth: 0.02 }), 200);
  assertEquals(await send("eth", { address: PLAIN, eth: 5 }), 400);
  assertEquals(await send("test-usd", { address: PLAIN, usd: 2500 }), 200);
  assertEquals(await send("test-usd", { address: PLAIN, usd: 2_000_000 }), 400);
  assertEquals(await send("test-usd", { address: PLAIN, usd: 1.5 }), 400);
  assertEquals(state.sent, [
    { fn: "drip", to: PLAIN, value: 20_000_000_000_000_000n },
    { fn: "testUsd", token: tusd, to: PLAIN, amount: 2_500_000_000n },
  ]);
  state.balances.set(RELAYER, 0n);
  assertEquals(await send("eth", { address: PLAIN, eth: 0.02 }), 409);
  h.close();
});

Deno.test("vote round ballot: refusals", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, VOTER.address);
  const post = async (body: unknown) => {
    const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
    return [res.status, (await j(res)).code];
  };
  const zero = bytesToHex(Uint8Array.from([0, 255, 255]));
  assertEquals(await post(await signedBallot(VOTER, 17n, 1n, zero)), [400, "bad_ballot"]);
  assertEquals(await post(await signedBallot(VOTER, 17n, 1n, "0x01ff")), [400, "bad_ballot"]);
  assertEquals(await post(await signedBallot(OTHER, 17n, 1n, BALLOT)), [401, "bad_signature"]);
  assertEquals(await post({ tokenId: "x", nonce: "1", ballot: BALLOT, signature: "0x" }), [
    400,
    "bad_ballot",
  ]);
  assertEquals(await post(await signedBallot(VOTER, 17n, 2n, BALLOT)), [409, "stale_nonce"]);
  assertEquals(await post(await signedBallot(VOTER, 99n, 1n, BALLOT)), [404, "no_badge"]);
  h.clock.now = manifest.closesAt;
  assertEquals(await post(await signedBallot(VOTER, 17n, 1n, BALLOT)), [410, "closed"]);
  assertEquals(state.sent, []);
  h.close();
});

Deno.test("vote round ballot: a second relay of the same nonce returns the pending hash", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, BALLOT);
  const first = await j(await h.req("/api/vote/ballot", { method: "POST", json: body }));
  const again = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(again.status, 409);
  const out = await j(again);
  assertEquals([out.code, out.hash], ["pending", first.hash]);
  assertEquals(state.sent.length, 1);
  h.close();
});

Deno.test("vote round ballots: latest per badge, only before the close, cached briefly", async () => {
  const { h, state } = await setup();
  state.logs = [
    { tokenId: "1", ballot: "0x01ffff", timestamp: NOW - 100 },
    { tokenId: "2", ballot: "0xff01ff", timestamp: NOW - 90 },
    { tokenId: "1", ballot: "0xffff01", timestamp: NOW - 80 },
    { tokenId: "2", ballot: "0x010101", timestamp: manifest.closesAt },
  ];
  const res = await h.req("/api/vote/ballots");
  assertEquals(res.status, 200);
  const body = await j(res);
  assertEquals(body.ballots, [
    { tokenId: "1", ballot: "0xffff01" },
    { tokenId: "2", ballot: "0xff01ff" },
  ]);
  await h.req("/api/vote/ballots");
  assertEquals(state.ballotReads, 1);
  h.clock.now += 6;
  await h.req("/api/vote/ballots");
  assertEquals(state.ballotReads, 2);
  h.close();
});

Deno.test("vote round ballots: closed results are revalidated after the short memory cache", async () => {
  const { h, state } = await setup();
  h.clock.now = manifest.closesAt + 60 * 60;
  await h.req("/api/vote/ballots");
  h.clock.now += 24 * 60 * 60;
  await h.req("/api/vote/ballots");
  assertEquals(state.ballotReads, 2);
  h.close();
});

Deno.test("vote round gas: tops up a low balance once per badge, only for its owner", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, PLAIN);
  const token = await h.mint(PLAIN);
  const other = await h.mint(OTHER.address);
  const gas = (t: string) =>
    h.req("/api/vote/gas", { method: "POST", token: t, json: { tokenId: "17" } });

  const notOwner = await gas(other);
  assertEquals(notOwner.status, 403);

  const first = await gas(token);
  assertEquals(first.status, 200);
  assertEquals(typeof (await j(first)).hash, "string");
  assertEquals(state.sent.at(-1), { fn: "drip", to: PLAIN, value: 5_000_000_000_000_000n });

  const again = await gas(token);
  assertEquals([again.status, (await j(again)).code], [409, "already_dripped"]);
  assertEquals(state.sent.length, 1);
  h.close();
});

Deno.test("vote round gas: enough balance already needs no drip and leaves the one-time drip unused", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, PLAIN);
  state.balances.set(PLAIN.toLowerCase(), 10n ** 18n);
  const token = await h.mint(PLAIN);
  const res = await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } });
  assertEquals(await j(res), { hash: null });
  state.balances.set(PLAIN.toLowerCase(), 0n);
  const later = await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } });
  assertEquals(later.status, 200);
  assertEquals(state.sent.length, 1);
  h.close();
});

Deno.test("vote round gas: closed after the vote", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, PLAIN);
  const token = await h.mint(PLAIN);
  h.clock.now = manifest.closesAt;
  const res = await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } });
  assertEquals([res.status, (await j(res)).code], [410, "closed"]);
  h.close();
});

Deno.test("vote round ballots: a revoked (burned) badge's earlier ballot no longer counts", async () => {
  const { h, state } = await setup();
  state.logs = [
    { tokenId: "1", ballot: "0x01ffff", timestamp: NOW - 100 },
    { tokenId: "2", ballot: "0xff01ff", timestamp: NOW - 95 },
    { tokenId: "1", revoked: true, timestamp: NOW - 90 },
    { tokenId: "2", revoked: true, timestamp: NOW - 85 },
    { tokenId: "2", ballot: "0xffff01", timestamp: NOW - 80 },
  ];
  const body = await j(await h.req("/api/vote/ballots"));
  assertEquals(body.ballots, [{ tokenId: "2", ballot: "0xffff01" }]);
  h.close();
});

Deno.test("vote round relayer: nonces stay consecutive while the RPC's pending count lags", async () => {
  const { h, state } = await setup();
  for (const who of [PLAIN, OTHER.address]) assertEquals((await give(h, who)).status, 200);
  assertEquals(state.nonces_used, [0, 1]);
  state.chainNonce = 5; // the chain moved on (e.g. a manual tx): follow it
  await give(h, privateKeyToAccount(`0x${"44".repeat(32)}`).address);
  assertEquals(state.nonces_used, [0, 1, 5]);
  h.close();
});

Deno.test("vote round ballot: a pending relay that reverted no longer blocks a retry", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, BALLOT);
  const first = await j(await h.req("/api/vote/ballot", { method: "POST", json: body }));
  state.txStatus.set(first.hash as string, "reverted");
  const again = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(again.status, 200);
  assertEquals(state.sent.length, 2);
  h.close();
});

Deno.test("vote round ballot: a pending relay the node never saw frees after a minute", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, BALLOT);
  const first = await j(await h.req("/api/vote/ballot", { method: "POST", json: body }));
  state.txStatus.set(first.hash as string, "unknown");
  assertEquals((await h.req("/api/vote/ballot", { method: "POST", json: body })).status, 409);
  h.clock.now += 61;
  assertEquals((await h.req("/api/vote/ballot", { method: "POST", json: body })).status, 200);
  h.close();
});

Deno.test("vote round ballot: the relay pays for at most 20 ballots per badge", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, VOTER.address);
  for (let i = 1; i <= 20; i++) {
    const res = await h.req("/api/vote/ballot", {
      method: "POST",
      json: await signedBallot(VOTER, 17n, BigInt(i), BALLOT),
    });
    assertEquals(res.status, 200, `relay ${i}`);
    state.nonces.set(17n, BigInt(i));
  }
  const over = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 17n, 21n, BALLOT),
  });
  assertEquals([over.status, (await j(over)).code], [429, "relay_limit"]);
  assertEquals(state.sent.length, 20);
  h.close();
});

Deno.test("vote round relayer: a dropped relay's nonce is reused, so later sends don't queue behind a gap", async () => {
  const { h, state } = await setup();
  const first = await j(await give(h, PLAIN));
  // The node never saw it, and its pending count stays at 0.
  state.txStatus.set(first.hash as string, "unknown");
  await give(h, OTHER.address);
  assertEquals(state.nonces_used, [0, 1], "within a minute it may still arrive");
  state.txStatus.set(`0x${(2).toString(16).padStart(64, "0")}`, "unknown");
  h.clock.now += 61;
  await give(h, privateKeyToAccount(`0x${"44".repeat(32)}`).address);
  assertEquals(state.nonces_used, [0, 1, 0]);
  h.close();
});

Deno.test("vote round: a new round starts clean (gas and badge numbers are per contract)", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, PLAIN);
  const token = await h.mint(PLAIN);
  // Team test round: badge 1 given, and badge 17's gas drip.
  assertEquals((await j(await give(h, OTHER.address))).tokenId, 1);
  assertEquals(
    (await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } })).status,
    200,
  );

  // The public round: same badge numbers, a new contract.
  const next = fakeChain();
  next.state.owners.set(17n, PLAIN);
  next.state.balances.set(RELAYER, 10n ** 18n);
  h.deps.vote = {
    chain: next.chain,
    manifest: { ...manifest, contract: "0x2000000000000000000000000000000000000002" },
  };
  const third = privateKeyToAccount(`0x${"44".repeat(32)}`).address;
  assertEquals((await j(await give(h, third))).tokenId, 1, "badge 1 is free in the new round");
  const gas = await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } });
  assertEquals(gas.status, 200, "the badge's one drip is per round");
  h.close();
});

// ---------------------------------------------------------------- quiet ending
/** Pool $200 (micro-units here: 200), three initiatives needing 150 each. */
const qe: VoteManifest = { ...manifest, poolUsd: "200" };
const X = "ff";
const logOf = (tokenId: string, ballot: string, timestamp: number, block: number) => ({
  tokenId,
  ballot: `0x${ballot}` as Hex,
  timestamp,
  block,
  nonce: 1,
});

async function qeSetup(asks = [150n, 150n, 150n]) {
  const { h, state, chain } = await setup(qe);
  state.asks = asks;
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  return { h, state, chain };
}

Deno.test("the round lists each initiative's gap to the next tier", async () => {
  // Real-sized money: gaps are whole $1K steps, so a $200 pool could never reach one.
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  state.asks = [3_000_000_000n, 3_000_000_000n, 3_000_000_000n];
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  type Next = { tier: string; gap: string | null };
  type Body = { live: { next?: Record<string, Next> } };
  // The first read starts the search and doesn't wait for it.
  const first = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(first.live.next, undefined);
  await h.settle();
  // Once it is done, the cached round carries it.
  const open = await j(await h.req("/api/vote/round")) as Body;
  const next = open.live.next!;
  assertEquals(next.a, undefined, "funded in S-Tier: no next tier");
  assertEquals(next.b.tier, "B");
  assertEquals(next.b.gap, "3000000000");
  // Once the round closes there is no live tally, so nothing to look ahead at.
  h.clock.now = NOW + 7200;
  const closed = await j(await h.req("/api/vote/round")) as {
    closed: boolean;
    live: { next?: unknown };
  };
  assertEquals(closed.closed, true);
  assertEquals(closed.live.next, undefined);
  await h.settle();
  h.close();
});

Deno.test("round: after a new ballot the gaps from before it are marked stale until searched again", async () => {
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  state.asks = [3_000_000_000n, 3_000_000_000n, 3_000_000_000n];
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  type Body = { accepted: object; live: { next?: object; aheadStale?: boolean } };
  await h.req("/api/vote/round");
  await h.settle();
  const before = await j(await h.req("/api/vote/round")) as Body;
  assertEquals([Boolean(before.live.next), before.live.aheadStale], [true, undefined]);
  // Somebody else's ballot: the live tally changes at once; the gaps are a search behind.
  state.logs.push(logOf("3", `${X}01${X}`, NOW - 5, 3));
  h.clock.now += 10;
  const after = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(Object.keys(after.accepted), ["1", "2", "3"]);
  assertEquals([Boolean(after.live.next), after.live.aheadStale], [true, true]);
  await h.settle();
  h.clock.now += 10;
  const searched = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(searched.live.aheadStale, undefined);
  await h.settle();
  h.close();
});

Deno.test("round next: who it knocks out is named by slug", async () => {
  // $100K pool. Two voters back b ($40K) below c (out of anyone's reach), so b is funded
  // after the first tier. Backing a ($70K) to B-Tier's gap funds it first and leaves
  // too little for b.
  const { h, state } = await setup({ ...qe, poolUsd: "100000000000" });
  state.asks = [70_000_000_000n, 40_000_000_000n, 1n << 60n];
  const backsB = bytesToHex(encodeBallot(qe.slugs, { c: "S", b: "B" })).slice(2);
  state.logs = [logOf("1", backsB, NOW - 100, 1), logOf("2", backsB, NOW - 90, 2)];
  await h.req("/api/vote/round");
  await h.settle();
  type Knock = { slug: string; tier: string };
  const body = await j(await h.req("/api/vote/round")) as {
    live: {
      tiers: Record<string, string>;
      next: Record<string, { gap: string; comesIn: Knock[]; dropsOut: Knock[]; moves: Knock[] }>;
    };
  };
  assertEquals(body.live.tiers, { b: "A" });
  const a = body.live.next.a;
  assertEquals(a.gap, "70000000000");
  assertEquals(a.dropsOut, [{ slug: "b", tier: "A" }]);
  assertEquals([a.comesIn, a.moves], [[], []]);
  await h.settle();
  h.close();
});

Deno.test("the round lists the donation that moves each initiative up a tier", async () => {
  // As above: b is funded in A-Tier, c (S-Tier on both ballots) costs far more than the pool.
  const { h, state } = await setup({ ...qe, poolUsd: "100000000000" });
  const huge = 1n << 60n;
  state.asks = [70_000_000_000n, 40_000_000_000n, huge];
  const backsB = bytesToHex(encodeBallot(qe.slugs, { c: "S", b: "B" })).slice(2);
  state.logs = [logOf("1", backsB, NOW - 100, 1), logOf("2", backsB, NOW - 90, 2)];
  await h.req("/api/vote/round");
  await h.settle();
  type Give = { tier: string; gap: string | null };
  const body = await j(await h.req("/api/vote/round")) as { live: { give: Record<string, Give> } };
  const give = body.live.give;
  // c isn't funded, so the search aims for B-Tier, the first tier up; both ballots have
  // it in S-Tier, so the donation that gets it there lands it in S-Tier (#101).
  assertEquals(give.c.tier, "S");
  // Given all but what the two ballots hold ($100K), c is funded.
  // In $10 steps, rounded up.
  const step = 10_000_000n;
  const want = ((huge - 100_000_000_000n + step - 1n) / step) * step;
  assertEquals(give.c.gap, want.toString());
  await h.settle();
  h.close();
});

Deno.test("round next: the same tally inputs are searched once", async () => {
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  state.asks = [3_000_000_000n, 3_000_000_000n, 3_000_000_000n];
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  let searches = 0;
  const collect = h.deps.background!;
  h.deps.background = (work) => (searches++, collect(work));
  // The ballots replay the round too, but need no gaps.
  await h.req("/api/vote/ballots");
  assertEquals(searches, 0);
  await h.req("/api/vote/round");
  await h.settle();
  // The round cache has expired, but nothing the tally reads has changed.
  h.clock.now += 10;
  const body = await j(await h.req("/api/vote/round")) as { live: { next?: unknown } };
  await h.settle();
  assertEquals(searches, 1);
  assertEquals(body.live.next !== undefined, true);
  // A new ballot changes the inputs: searched again, the last result served meanwhile.
  state.logs.push(logOf("3", `0101${X}`, NOW - 5, 3));
  h.clock.now += 10;
  const again = await j(await h.req("/api/vote/round")) as { live: { next?: unknown } };
  assertEquals(again.live.next, body.live.next);
  await h.settle();
  assertEquals(searches, 2);
  await h.settle();
  h.close();
});

/** $6K pool, $3K asks; both voters back a alone, so the live tally funds a in S-Tier. */
async function threatSetup() {
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  state.asks = [3_000_000_000n, 3_000_000_000n, 3_000_000_000n];
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  return { h, state };
}
type LiveBody = {
  live: {
    next?: unknown;
    give?: unknown;
    lead?: Record<string, string>;
    threat?: Record<string, string | null>;
  };
};

Deno.test("an open round serves each S-Tier initiative's threat", async () => {
  const { h } = await threatSetup();
  // Like the gaps: the first read starts the work and doesn't wait for it.
  const first = await j(await h.req("/api/vote/round")) as LiveBody;
  assertEquals(first.live.threat, undefined);
  await h.settle();
  const body = await j(await h.req("/api/vote/round")) as LiveBody;
  assertEquals(body.live.next !== undefined, true);
  // a costs $3K of the voters' $6K and nothing else is ranked: no donation elsewhere
  // pushes it out.
  assertEquals(body.live.threat, { a: null });
  assertEquals(body.live.lead, undefined);
  await h.settle();
  h.close();
});

Deno.test("once S-Tier has settled, the threats are A-Tier's", async () => {
  const { h } = await threatSetup();
  h.clock.now = NOW + 700; // S settled at NOW + 660; A is open
  await h.req("/api/vote/round");
  await h.settle();
  h.clock.now += 10;
  const body = await j(await h.req("/api/vote/round")) as LiveBody;
  assertEquals(body.live.next !== undefined, true, "the search ran");
  // a was S-Tier's; the ballots rank nothing else, so A-Tier funds nothing to threaten.
  assertEquals(body.live.threat, {});
  await h.settle();
  h.close();
});

Deno.test("a failed threat search keeps the gaps", async () => {
  const { h } = await threatSetup();
  const real = voteSearches.threats;
  voteSearches.threats = () => Promise.reject(new Error("boom"));
  try {
    await h.req("/api/vote/round");
    await h.settle();
    const body = await j(await h.req("/api/vote/round")) as LiveBody;
    assertEquals(body.live.next !== undefined, true);
    assertEquals(body.live.give !== undefined, true);
    assertEquals(body.live.threat, undefined);
    await h.settle();
  } finally {
    voteSearches.threats = real;
  }
  h.close();
});

/** A closed round. $10K pool. Both voters back a first, then b and c: a is funded in
 * S-Tier, b in A-Tier, and c needs more than what's left once a and b are paid, so it
 * never is. */
async function closedSetup() {
  const got = await setup({ ...qe, poolUsd: "10000000000" });
  const { h, state } = got;
  state.asks = [3_000_000_000n, 3_000_000_000n, 5_000_000_000n];
  const ballot = bytesToHex(encodeBallot(qe.slugs, { a: "S", b: "B", c: "B" })).slice(2);
  state.logs = [logOf("1", ballot, NOW - 100, 1), logOf("2", ballot, NOW - 90, 2)];
  h.clock.now = NOW + 7200;
  return got;
}
const roundKey = ["vote", qe.contract.toLowerCase(), "round"];
/** The closed round's cached entry as another isolate wrote it, without the what-ifs:
 * this isolate has nothing in memory, and KV has no `final` entry. */
async function closedCachedElsewhere() {
  const other = await closedSetup();
  await other.h.req("/api/vote/round");
  await other.h.settle();
  const entry = {
    at: other.h.clock.now,
    body: await j(await other.h.req("/api/vote/round")),
    finalKey: "obsolete",
  };
  other.h.close();
  assertEquals(typeof entry.finalKey, "string");
  const here = await closedSetup();
  await here.h.kv.set(roundKey, entry);
  return { ...here, entry };
}

Deno.test("a closed round ignores obsolete saved results and computes its what-ifs", async () => {
  const { h, state } = await closedCachedElsewhere();
  type Body = { final?: unknown };
  const first = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(first.final, undefined);
  assertEquals(state.ballotReads, 1, "replayed to start the search");
  // The search is running: the cached round is served, no second replay.
  const second = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(second.final, undefined);
  assertEquals(state.ballotReads, 1);
  await h.settle();
  const done = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(done.final !== undefined, true);
  assertEquals(state.ballotReads, 1);
  await h.settle();
  h.close();
});

Deno.test("an unreadable chain never falls back to an old cached allocation", async () => {
  const { h, state, chain } = await closedCachedElsewhere();
  const ballots = chain.ballots;
  chain.ballots = () => {
    state.ballotReads++;
    return Promise.reject(new Error("RPC down"));
  };
  const first = await h.req("/api/vote/round");
  assertEquals(first.status, 503);
  assertEquals((await j(first)).code, "asks_unavailable");
  chain.ballots = ballots;
  h.clock.now += 6;
  assertEquals((await h.req("/api/vote/round")).status, 200);
  await h.settle();
  h.close();
});

Deno.test("a closed round serves the final what-ifs", async () => {
  const { h } = await closedSetup();
  type Final = {
    next: Record<string, { tier: string; gap: string | null }>;
    lead: Record<string, string>;
  };
  type Body = {
    closed: boolean;
    tiers: { funded: string[] }[];
    live: { next?: unknown; lead?: unknown };
    final?: Final;
  };
  // Never waits for the what-ifs.
  const first = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(first.closed, true);
  assertEquals(first.tiers.map((t) => t.funded), [["a"], ["b"], []]);
  assertEquals(first.final, undefined);
  await h.settle();
  // The short-lived replay is reused; derived what-ifs come with its result.
  const body = await j(await h.req("/api/vote/round")) as Body;
  const final = body.final!;
  assertEquals([body.live.next, body.live.lead], [undefined, undefined]);
  assertEquals(final.next.b.tier, "S");
  assertEquals(final.next.c.tier, "B");
  assertEquals(final.next.a, undefined, "S-Tier has a lead, not a next tier");
  assertEquals(final.lead.a !== undefined && BigInt(final.lead.a) >= 1_000_000_000n, true);
  assertEquals(
    ((await h.kv.get(["vote", qe.contract.toLowerCase(), "final"])).value as { final: Final })
      .final,
    final,
  );
  await h.settle();
  h.close();
});

Deno.test("round: a round too large for one KV value is served, just not cached", async () => {
  const { h, state } = await qeSetup();
  // Thousands of accepted ballots: the round's JSON is well over KV's 64 KiB.
  state.logs = Array.from(
    { length: 4000 },
    (_, i) => logOf(String(i + 1), `01${X}${X}`, NOW - 100, i + 1),
  );
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 200);
  assertEquals(Object.keys((await j(res) as { accepted: object }).accepted).length, 4000);
  await h.settle();
  assertEquals((await h.kv.get(["vote", qe.contract.toLowerCase(), "round"])).value, null);
  await h.settle();
  h.close();
});

Deno.test("errorText: URLs are cut from logged errors (an RPC URL may carry its key)", () => {
  const e = new Error(
    "HTTP request failed.\n\nURL: https://eth.archive.example/v2/SECRETKEY\nRequest body: {}",
  );
  assertEquals(errorText(e), "HTTP request failed.\n\nURL: <rpc>\nRequest body: {}");
  assertEquals(errorText("wss://node.example/ws/KEY down"), "<rpc> down");
  assertEquals(errorText(new Error("missing trie node")), "missing trie node");
});

Deno.test("cacheSet: a value over the KV limit is skipped, never thrown", async () => {
  const kv = await Deno.openKv(":memory:");
  assertEquals(await cacheSet(kv, ["big"], { stub: "x".repeat(70_000) }), false);
  assertEquals((await kv.get(["big"])).value, null);
  assertEquals(await cacheSet(kv, ["small"], { stub: "x" }), true);
  assertEquals((await kv.get(["small"])).value, { stub: "x" });
  kv.close();
});

Deno.test("round: before S's first tally every tier waits; the live tally funds a", async () => {
  const { h } = await qeSetup();
  const body = await j(await h.req("/api/vote/round")) as
    & { tiers: { status: string }[] }
    & Record<string, unknown>;
  assertEquals(body.tiers.map((t: { status: string }) => t.status), [
    "waiting",
    "waiting",
    "waiting",
  ]);
  const { next: _next, inputs, ...live } = body.live as { next?: unknown; inputs?: unknown };
  // The tally's inputs come along (a donation's preview re-runs it): its first open tier.
  assertEquals((inputs as { first: number }).first, 0);
  // Both badges rank only A: each would pay half of it, if S-Tier settled now.
  assertEquals(live, {
    funded: ["a"],
    awards: { a: "150" },
    tiers: { a: "S" },
    paid: { "1": { a: "75" }, "2": { a: "75" } },
    covered: [],
    withdrawn: [],
  });
  assertEquals(body.registrationClosesAt, NOW + 660);
  assertEquals(body.accepted, { "1": `0x01${X}${X}`, "2": `0x01${X}${X}` });
  await h.settle();
  h.close();
});

Deno.test("round: historical asks preserve S-Tier awards without storing a settlement", async () => {
  const { h, state } = await qeSetup();
  h.clock.now = NOW + 700; // settled at NOW + 660, but logs before it may still arrive
  await h.req("/api/vote/round");
  assertEquals(
    (await h.deps.db.kv.get(["vote", qe.contract.toLowerCase(), "settled-w1", "S"])).value,
    null,
  );
  // A donation after the cutoff doesn't move it: it settled with the asks before it.
  state.states = [
    ...oneState([150n, 150n, 150n], 200n),
    stateAt(5, NOW + 690, [10n, 10n, 10n], 200n),
  ];
  h.clock.now += 10;
  const fresh = await j(await h.req("/api/vote/round")) as { tiers: { awards: unknown }[] };
  assertEquals(fresh.tiers[0].awards, { a: "150" });
  await h.settle();
  h.close();
});

Deno.test("round: each badge's share, and what it paid in a settled tier", async () => {
  const { h } = await qeSetup();
  h.clock.now = NOW + 700;
  const body = await j(await h.req("/api/vote/round")) as {
    share: string;
    tiers: { paid?: Record<string, Record<string, string>> }[];
  };
  assertEquals(body.share, "100");
  assertEquals(body.tiers[0].paid, { "1": { a: "75" }, "2": { a: "75" } });
  await h.settle();
  h.close();
});

Deno.test("ballots: only what the quiet ending counts (a refused revision isn't served)", async () => {
  const { h, state } = await qeSetup();
  state.logs.push(logOf("1", `${X}01${X}`, NOW + 700, 3)); // moves a out of settled S
  h.clock.now = NOW + 710;
  const body = await j(await h.req("/api/vote/ballots")) as { ballots: unknown[] };
  assertEquals(body.ballots, [
    { tokenId: "1", ballot: `0x01${X}${X}` },
    { tokenId: "2", ballot: `0x01${X}${X}` },
  ]);
  h.close();
});

Deno.test("round: a quiet window settles S-Tier; later ask changes never move it", async () => {
  const { h, state } = await qeSetup();
  h.clock.now = NOW + 660 + 30 * 60;
  const first = await j(await h.req("/api/vote/round")) as { tiers: unknown[] };
  assertEquals(first.tiers[0], {
    tier: "S",
    status: "settled",
    at: NOW + 660,
    forced: false,
    confirmed: false,
    funded: ["a"],
    covered: [],
    withdrawn: [],
    awards: { a: "150" },
    paid: { "1": { a: "75" }, "2": { a: "75" } },
  });
  state.states = [
    ...oneState([150n, 150n, 150n], 200n),
    stateAt(5, NOW + 690, [10n, 10n, 10n], 200n),
  ];
  h.clock.now += 10;
  const later = await j(await h.req("/api/vote/round")) as { tiers: { awards: unknown }[] };
  assertEquals(later.tiers[0].awards, { a: "150" });
  await h.settle();
  h.close();
});

Deno.test("round ballot: a settled tier can't change; registration closes; B settled closes", async () => {
  const { h, state } = await qeSetup();
  state.owners.set(1n, VOTER.address);
  state.owners.set(3n, VOTER.address);
  state.nonces.set(1n, 1n);
  h.clock.now = NOW + 700;
  const moved = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 1n, 2n, `0x${X}01${X}`, qe),
  });
  const refusedBody = await j(moved) as { code: string; error?: string; message?: string };
  assertEquals([moved.status, refusedBody.code], [409, "tier_settled"]);
  assertEquals(
    refusedBody.error ?? refusedBody.message,
    "S-Tier has settled: its initiatives can't move.",
  );
  const late = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 3n, 1n, `0x01${X}${X}`, qe),
  });
  assertEquals([late.status, (await j(late)).code], [403, "registration_closed"]);
  h.clock.now = NOW + 800;
  const over = await h.req("/api/vote/ballot", {
    method: "POST",
    json: await signedBallot(VOTER, 1n, 2n, `0x0102${X}`, qe),
  });
  assertEquals([over.status, (await j(over)).code], [410, "closed"]);
  h.close();
});

Deno.test("round: an RPC without past state is a 503, not a result", async () => {
  const { h, state } = await qeSetup();
  state.asks = "fail"; // the node pruned the blocks the replay reads
  const res = await h.req("/api/vote/round");
  const body = await j(res);
  assertEquals([res.status, body.code], [503, "asks_unavailable"]);
  assertEquals(body.error, "The vote results can't be read from the chain right now.");
  assertEquals((await h.kv.get(["vote", qe.contract.toLowerCase(), "round"])).value, null);
  await h.settle();
  h.close();
});

Deno.test("round: the round's asks come from the chain states, not the board", async () => {
  // The board has none of a, b, c; the chain asks are what the tally and the page use.
  const { h, state, chain } = await qeSetup([10n, 20n, 30n]);
  chain.asks = () => Promise.reject(new Error("the head read is the states' own"));
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 200);
  const body = await j(res) as { asks: string[]; live: { inputs: LiveInputsJson } };
  assertEquals(body.asks, ["10", "20", "30"]);
  assertEquals(body.live.inputs.costs, ["10", "20", "30"]);
  assertEquals(state.stateReads, 1);
  await h.settle();
  h.close();
});

Deno.test("round: a donation inside the S-Tier window shows the tier still settling", async () => {
  // Two windows: S-Tier's first ends at NOW + 660, its second at NOW + 690.
  const { h, state } = await setup({ ...qe, schedule: { ...qe.schedule, maxWindows: 2 } });
  // Both voters rank a and b in S-Tier; at $150 each only one fits the $200 pool.
  state.logs = [logOf("1", `0101${X}`, NOW - 100, 1), logOf("2", `0101${X}`, NOW - 90, 2)];
  state.states = oneState([150n, 150n, 150n], 200n);
  h.clock.now = NOW + 670;
  type Body = { tiers: { status: string; window?: number; funded?: string[] }[] };
  const quiet = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(quiet.tiers[0].status, "settled", "no change: the first window settles it");
  // A donation at NOW + 630 brings b's ask to $50: both fit, so the window wasn't quiet.
  state.states = [
    ...oneState([150n, 150n, 150n], 200n),
    stateAt(5, NOW + 630, [150n, 50n, 150n], 200n),
  ];
  h.clock.now += 10;
  const moved = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(moved.tiers[0].status, "settling");
  assertEquals(moved.tiers[0].window, 2);
  assertEquals(moved.tiers[0].funded!.sort(), ["a", "b"]);
  await h.settle();
  h.close();
});

Deno.test("round: a covered project is listed as covered", async () => {
  // b asks $0: covered by donations, in no tier.
  const { h } = await qeSetup([150n, 0n, 150n]);
  type Body = { tiers: { status: string; covered?: string[] }[]; live: { covered: string[] } };
  const open = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(open.live.covered, ["b"]);
  h.clock.now = NOW + 700;
  const settled = await j(await h.req("/api/vote/round")) as Body;
  assertEquals([settled.tiers[0].status, settled.tiers[0].covered], ["settled", ["b"]]);
  assertEquals(settled.live.covered, [], "covered at S-Tier's settlement: final");
  await h.settle();
  h.close();
});

Deno.test("round: a settled tier is stable without persisting any result", async () => {
  const { h } = await qeSetup([150n, 0n, 150n]);
  const key = ["vote", qe.contract.toLowerCase(), "settled-w1", "S"];
  h.clock.now = NOW + 700;
  const before = (await j(await h.req("/api/vote/round")) as { tiers: unknown[] }).tiers[0];
  assertEquals((await h.kv.get(key)).value, null);
  h.clock.now = NOW + 660 + 30 * 60;
  const stored = (await j(await h.req("/api/vote/round")) as { tiers: unknown[] }).tiers[0];
  assertEquals((await h.kv.get(key)).value, null);
  assertEquals(stored, before);
  // Read back from the record: the same again.
  h.clock.now += 10;
  const again = (await j(await h.req("/api/vote/round")) as { tiers: unknown[] }).tiers[0];
  assertEquals(again, before);
  await h.settle();
  h.close();
});

Deno.test("round: neither lagging nor caught-up states create authoritative result caches", async () => {
  const { h, state } = await qeSetup([150n, 0n, 150n]);
  const key = ["vote", qe.contract.toLowerCase(), "settled-w1", "S"];
  h.clock.now = NOW + 660 + 30 * 60;
  // The states node stopped before the cutoff at NOW + 660: what came after is unseen.
  state.headAt = NOW + 600;
  await h.req("/api/vote/round");
  assertEquals((await h.kv.get(key)).value, null);
  // Once it has caught up, replay still creates no authoritative result cache.
  state.headAt = null;
  h.clock.now += 10;
  await h.req("/api/vote/round");
  assertEquals((await h.kv.get(key)).value, null);
  await h.settle();
  h.close();
});

Deno.test("round: served as of the newest block: past a cutoff by the clock only, nothing settles", async () => {
  const { h, state } = await qeSetup();
  type Body = { head: { timestamp: number }; tiers: { tier: string; status: string }[] };
  // S-Tier's one window ends at NOW + 660. The clock is 5 s past it; the newest block is
  // 3 s before it, so a ballot could still land in a block before the cutoff.
  h.clock.now = NOW + 665;
  state.headAt = NOW + 657;
  const lagging = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(lagging.head.timestamp, NOW + 657);
  assertEquals([lagging.tiers[0].tier, lagging.tiers[0].status], ["S", "settling"]);
  // Nothing settled is stored from it.
  assertEquals(
    (await h.kv.get(["vote", qe.contract.toLowerCase(), "settled-w1", "S"])).value,
    null,
  );
  // The block at NOW + 659: every block before the cutoff is known. S-Tier settles.
  state.headAt = NOW + 659;
  h.clock.now += 10; // past the few seconds a replay is reused
  const confirmed = await j(await h.req("/api/vote/round")) as Body;
  assertEquals(confirmed.tiers[0].status, "settled");
  await h.settle();
  h.close();
});

Deno.test("round: corrupt settlement caches cannot alter coverage, awards or accepted ballots", async () => {
  const { h } = await qeSetup([150n, 0n, 150n]);
  h.clock.now = NOW + 2500;
  const key = ["vote", qe.contract.toLowerCase(), "settled-w1", "S"];
  await h.kv.set(key, {
    tier: "S",
    at: NOW,
    funded: [2],
    awards: [[2, "999"]],
    shares: [],
    covered: [],
    withdrawn: [],
  });
  const body = await j(await h.req("/api/vote/round")) as {
    tiers: { funded: string[]; covered: string[]; awards: unknown }[];
  };
  assertEquals(body.tiers[0].funded, ["a"]);
  assertEquals(body.tiers[0].covered, ["b"]);
  assertEquals(body.tiers[0].awards, { a: "150" });
  await h.settle();
  h.close();
});

Deno.test("round: a cold chain read answers 503 in time and fills in the background, one at a time", async () => {
  const { h, state } = await qeSetup();
  let finish = () => {};
  const slow = new Promise<ChainState[]>((ok) => {
    finish = () => ok(withHead([150n, 150n, 150n], 200n));
  });
  const reads = { n: 0 };
  h.deps.vote!.states = () => (reads.n++, slow);
  h.deps.vote!.statesWaitMs = 20;
  const first = await h.req("/api/vote/round");
  assertEquals([first.status, (await j(first)).code], [503, "asks_unavailable"]);
  // A second request joins the read in flight instead of starting another.
  const second = await h.req("/api/vote/round");
  assertEquals([second.status, (await j(second)).code], [503, "asks_unavailable"]);
  assertEquals(reads.n, 1);
  finish();
  await h.settle();
  assertEquals((await h.req("/api/vote/round")).status, 200);
  assertEquals(state.ballotReads, 3);
  await h.settle();
  h.close();
});

Deno.test("round: a request with a newer ballot doesn't join a read that lacks its block", async () => {
  const { h, state } = await qeSetup();
  let finish = () => {};
  const first = new Promise<ChainState[]>((ok) => {
    finish = () => ok(withHead([150n, 150n, 150n], 200n));
  });
  const reads = { n: 0 };
  h.deps.vote!.states = () =>
    ++reads.n === 1 ? first : Promise.resolve(withHead([150n, 150n, 150n], 200n));
  const a = h.req("/api/vote/round");
  await new Promise((r) => setTimeout(r, 5));
  // A ballot at block 3 the first read has no state for.
  state.logs.push(logOf("3", `01${X}${X}`, NOW - 5, 3));
  const b = h.req("/api/vote/round");
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(reads.n, 1, "waits for the read in flight before starting its own");
  finish();
  const [ra, rb] = await Promise.all([a, b]);
  assertEquals([ra.status, rb.status], [200, 200]);
  assertEquals(reads.n, 2);
  assertEquals(Object.keys((await j(rb) as { accepted: object }).accepted), ["1", "2", "3"]);
  await h.settle();
  h.close();
});

Deno.test("round: a request whose ballots a read in flight covers joins it", async () => {
  const { h } = await qeSetup();
  let finish = () => {};
  const slow = new Promise<ChainState[]>((ok) => {
    finish = () => ok(withHead([150n, 150n, 150n], 200n));
  });
  const reads = { n: 0 };
  h.deps.vote!.states = () => (reads.n++, slow);
  const a = h.req("/api/vote/round");
  await new Promise((r) => setTimeout(r, 5));
  const b = h.req("/api/vote/round");
  await new Promise((r) => setTimeout(r, 5));
  finish();
  const [ra, rb] = await Promise.all([a, b]);
  assertEquals([ra.status, rb.status, reads.n], [200, 200, 1]);
  await h.settle();
  h.close();
});

Deno.test("round ballot: relayed ballots reuse one replay for a few seconds; none before registration closes", async () => {
  const { h, state } = await qeSetup();
  state.owners.set(1n, VOTER.address);
  const send = async (nonce: bigint) =>
    await h.req("/api/vote/ballot", {
      method: "POST",
      json: await signedBallot(VOTER, 1n, nonce, `0x0102${X}`, qe),
    });
  state.nonces.set(1n, 1n);
  assertEquals((await send(2n)).status, 200); // before registration closes: no replay
  assertEquals(state.ballotReads, 0);
  h.clock.now = NOW + 700;
  state.nonces.set(1n, 2n);
  assertEquals((await send(3n)).status, 200);
  state.nonces.set(1n, 3n);
  assertEquals((await send(4n)).status, 200);
  assertEquals(state.ballotReads, 1);
  h.close();
});

Deno.test("round: a ballot the RPC returned late can still unsettle S before it is final", async () => {
  const { h, state } = await qeSetup();
  h.clock.now = NOW + 700;
  const key = ["vote", qe.contract.toLowerCase(), "settled-w1", "S"];
  type Body = { tiers: { status: string; forced?: boolean }[] };
  const first = await j(await h.req("/api/vote/round")) as Body;
  assertEquals([first.tiers[0].status, first.tiers[0].forced], ["settled", false]);
  assertEquals((await h.deps.db.kv.get(key)).value, null);
  // A ballot inside S's window that the RPC hadn't returned: S changed after all.
  state.logs.push(logOf("2", `${X}01${X}`, NOW + 610, 3));
  h.clock.now += 10;
  const again = await j(await h.req("/api/vote/round")) as Body;
  // maxWindows 1: forced at the same cutoff.
  assertEquals([again.tiers[0].status, again.tiers[0].forced], ["settled", true]);
  // Time never creates an authoritative settlement cache.
  h.clock.now = NOW + 660 + 30 * 60;
  await h.req("/api/vote/round");
  assertEquals((await h.deps.db.kv.get(key)).value, null);
  await h.settle();
  h.close();
});

// ---------------------------------------------------------------- ballot rules
/** A round deployed with the ballot rules: four unrelated projects asking $100, pool $200. */
const ruled: VoteManifest = {
  ...manifest,
  poolUsd: "200",
  slugs: ["a", "b", "c", "d"],
  projects: ["a", "b", "c", "d"].map(() => ({ goalUsd: "100", rfp: false, groups: [] })),
  ballotRules: true,
};

Deno.test("round: an invalid ballot shows as refused with invalid_ballot", async () => {
  const { h, state } = await setup(ruled);
  state.logs = [
    logOf("1", "01010101", NOW - 100, 1), // S-Tier = a, b, c, d: valid
    logOf("2", `01030303`, NOW - 90, 2), // a rank gap: unreadable
  ];
  const body = await j(await h.req("/api/vote/round")) as {
    accepted: Record<string, string>;
    rejected: { tokenId: string; reason: string }[];
    poolUsd: string;
  };
  assertEquals(Object.keys(body.accepted), ["1"]);
  assertEquals(body.rejected.map((r) => [r.tokenId, r.reason]), [["2", "invalid_ballot"]]);
  assertEquals(body.poolUsd, "200");
  await h.settle();
  h.close();
});

Deno.test("round: a ballot the contract didn't commit is never counted", async () => {
  const { h, state } = await setup(ruled);
  state.logs = [logOf("1", "01010101", NOW - 100, 1)];
  state.transcriptOverride = `0x${"ab".repeat(32)}`;
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 503);
  const body = await j(res);
  assertEquals(body.code, "transcript_mismatch");
  assertEquals(
    body.error,
    "The ballots read don't match the contract; the results are back once they do.",
  );
  h.close();
});

Deno.test("round: a record count or a token's ballot hash the contract disagrees on is a 503", async () => {
  for (const wrong of ["count", "hash"] as const) {
    const { h, state } = await setup(ruled);
    state.logs = [logOf("1", "01010101", NOW - 100, 1), logOf("2", "01010101", NOW - 90, 2)];
    if (wrong === "count") state.countOverride = 3n;
    else state.hashOverride = { tokenId: "2", hash: `0x${"cd".repeat(32)}` };
    const res = await h.req("/api/vote/round");
    assertEquals(res.status, 503, wrong);
    assertEquals((await j(res)).code, "transcript_mismatch", wrong);
    h.close();
  }
});

Deno.test("round: a round from before Nov 14 is read with its legacy transcript", async () => {
  const { h, state } = await setup(ruled);
  state.legacyTranscript = true;
  state.logs = [logOf("1", "01010101", NOW - 100, 1)];
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 200);
  assertEquals(Object.keys((await j(res) as { accepted: object }).accepted), ["1"]);
  await h.settle();
  h.close();
});

Deno.test("round: the pool the chain raised shows, but recorded ballots aren't re-judged", async () => {
  const { h, state } = await setup(ruled);
  // Raised after ballot 1 (block 1) and before ballot 2 (block 2).
  state.history = { addedAt: [], pool: [{ block: 1, logIndex: 5, poolUsd: 1_000n }] };
  state.logs = [
    logOf("1", "01010101", NOW - 100, 1),
    logOf("2", "01010101", NOW - 90, 2), // the contract recorded it: the transcript proves it
  ];
  const body = await j(await h.req("/api/vote/round")) as {
    accepted: Record<string, string>;
    poolUsd: string;
  };
  assertEquals(Object.keys(body.accepted), ["1", "2"]);
  assertEquals(body.poolUsd, "1000");
  await h.settle();
  h.close();
});

Deno.test("ballot: a ballot breaking a rule is refused with its errors, nothing sent", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, `0x01${X}${X}${X}`, ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 422);
  const out = await j(res) as { code: string; errors: { rule: string }[] };
  assertEquals(out.code, "invalid_ballot");
  assertEquals(out.errors.map((e) => e.rule), ["size", "independent"]);
  assertEquals(state.sent, []);
  h.close();
});

Deno.test("ballot: a valid ballot is relayed with its proof", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, "0x01010101", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 200);
  const sent = state.sent[0] as unknown as { args: [{ proof: number[] }[]] };
  assertEquals(sent.args[0][0].proof, [0, 1, 2]);
  h.close();
});

Deno.test("ballot: judged with the chain's current pool", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  state.history.pool = [{ block: 1, logIndex: 0, poolUsd: 1_000n }];
  // The asks add up to $400, below 1.5 × the pool: placing all four would pass, so leave one out.
  const body = await signedBallot(VOTER, 17n, 1n, "0x010101ff", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 422);
  const out = await j(res) as { errors: Record<string, unknown>[] };
  assertEquals(out.errors, [{ rule: "size", requested: "300", needed: "400", pool: "1000" }]);
  assertEquals(state.sent, []);
  h.close();
});

Deno.test("ballot: a ballot signed before a project was added still relays (short)", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  const body = await signedBallot(VOTER, 17n, 1n, "0x010101", ruled); // a tab that knew 3
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 200);
  const sent = state.sent[0] as unknown as { args: [{ ballot: string; proof: number[] }[]] };
  assertEquals([sent.args[0][0].ballot, sent.args[0][0].proof], ["0x010101", [0, 1, 2]]);
  h.close();
});

Deno.test("ballot: a rule the contract enforced after a pool change is a 422, not a 500", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  // The pool rose after the replay this relay judged with: the contract refuses it.
  state.sendError = new Error(
    'The contract function "record" reverted.\n\nError: BallotTooSmall()',
  );
  const body = await signedBallot(VOTER, 17n, 1n, "0x01010101", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 422);
  assertEquals((await j(res)).code, "invalid_ballot");
  h.close();
});

Deno.test("ballot: before voting opens it is a 409 not_open, not a 500", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  h.clock.now = ruled.opensAt - 1;
  const body = await signedBallot(VOTER, 17n, 1n, "0x01010101", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 409);
  assertEquals((await j(res)).code, "not_open");
  assertEquals(state.sent.length, 0);
  h.close();
});

Deno.test("ballot: opened by the clock but not yet on-chain is a 409 not_open", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  // The newest block is still older than opensAt: the contract refuses it.
  state.sendError = new Error(
    'The contract function "record" reverted.\n\nError: VotingNotStarted()',
  );
  const body = await signedBallot(VOTER, 17n, 1n, "0x01010101", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 409);
  assertEquals((await j(res)).code, "not_open");
  h.close();
});

Deno.test("the round carries the chain asks", async () => {
  const { h, state } = await setup(ruled);
  state.asks = [10n, 20n, 30n, 40n];
  const body = await j(await h.req("/api/vote/round")) as { asks?: string[] };
  assertEquals(body.asks, ["10", "20", "30", "40"]);
  await h.settle();
  h.close();
});

Deno.test("a round without ballot rules still carries the chain asks", async () => {
  const { h, state } = await setup();
  state.asks = [1n, 2n, 3n];
  const body = await j(await h.req("/api/vote/round")) as { asks?: string[] };
  assertEquals(body.asks, ["1", "2", "3"]);
  await h.settle();
  h.close();
});

Deno.test("the relayer judges with chain asks", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  // The goals ($100 each) clear 1.5 × the pool of $200; what is still asked does not.
  state.asks = [50n, 50n, 50n, 50n];
  // The asks total $200, below 1.5 × the pool: the minimum is every ask, so leave one out.
  const body = await signedBallot(VOTER, 17n, 1n, "0x010101ff", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 422);
  const out = await j(res) as { code: string; errors: Record<string, unknown>[] };
  assertEquals(out.code, "invalid_ballot");
  assertEquals(out.errors, [{ rule: "size", requested: "150", needed: "200", pool: "200" }]);
  assertEquals(state.sent, []);
  h.close();
});

Deno.test("asks unavailable: the round and the relay are a 503", async () => {
  const { h, state } = await setup(ruled);
  state.owners.set(17n, VOTER.address);
  state.asks = "fail";
  const round = await h.req("/api/vote/round");
  assertEquals([round.status, (await j(round)).code], [503, "asks_unavailable"]);
  const body = await signedBallot(VOTER, 17n, 1n, "0x01010101", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 503);
  assertEquals((await j(res)).code, "asks_unavailable");
  assertEquals(state.sent, []);
  // A head with fewer projects than the site knows (not added on-chain yet): the round is
  // served, without asks, since a ballot can't be judged against them.
  state.asks = [1n];
  h.clock.now += 60;
  assertEquals("asks" in await j(await h.req("/api/vote/round")), false);
  await h.settle();
  h.close();
});

Deno.test("round: held while the chain has a project this site doesn't know yet", async () => {
  const { h, state } = await setup(ruled);
  // The admin added a fifth project; the manifest (and so the replay) still has four.
  state.history.addedAt = [null, null, null, null, { block: 5, logIndex: 0 }];
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 503);
  assertEquals((await j(res)).code, "round_out_of_date");
  h.close();
});

Deno.test("the round carries the live tally's inputs, which re-run to its result", async () => {
  const { h } = await threatSetup();
  const body = await j(await h.req("/api/vote/round")) as {
    live: { funded: string[]; inputs?: LiveInputsJson };
  };
  const { inp, first } = liveInputsFrom(body.live.inputs!);
  assertEquals(first, 0);
  const funded = chainTally(inp, first).flatMap((s) => s.order).map((c) => qe.slugs[c]);
  assertEquals(funded.sort(), [...body.live.funded].sort());
  await h.settle();
  h.close();
});

Deno.test("test pledge: on the test round's chain only, signed by the admin, then settled", async () => {
  const { h, state } = await setup();
  const base = "/api/admin/vote-round/test-pledges";
  const token = await h.mint(ADMIN, true);
  const post = (path: string, json: unknown) =>
    h.req(`${base}/${path}`, { method: "POST", token, json });
  // Unsigned: the form is told to sign first (the pledge form's 428).
  const plain = await post("b/pledges", { company: "Acme", amount: "1500" });
  assertEquals([plain.status, (await j(plain)).code], [428, "signature_required"]);
  // The typed data: initiative b is #1 in the round, the amount in micro-USD.
  const prep = await j(await post("b/pledges/prepare", { company: "Acme", amount: "1500" }));
  const typed = prep.typedData as { message: Record<string, string> };
  assertEquals([typed.message.initiativeId, typed.message.amount], ["1", "1500000000"]);
  assertEquals(String(prep.pid).startsWith("test-"), true);
  const sent = await post("b/pledges", {
    company: "Acme",
    amount: "1500",
    pid: prep.pid,
    nonce: typed.message.nonce,
    deadline: typed.message.deadline,
    signature: "0x1234",
  });
  assertEquals(sent.status, 202);
  const { hash } = await j(sent);
  const call = state.sent.at(-1)!;
  assertEquals(call.fn, "setPledgeBySig");
  if (call.fn === "setPledgeBySig") {
    assertEquals(call.args.slice(1, 5), [1n, 0n, 1_500_000_000n, ADMIN]);
  }
  state.txStatus.set(hash as string, "success");
  const settled = await post(`b/pledges/${prep.pid}/settle`, { hash });
  assertEquals((await j(settled)).state, "saved");
  // Not in the round, a received pledge, a plain account: refused.
  assertEquals((await post("nope/pledges/prepare", { amount: "1" })).status, 404);
  assertEquals((await post("b/pledges", { amount: "1", status: "received" })).status, 400);
  const plainUser = await h.mint(PLAIN);
  assertEquals(
    (await h.req(`${base}/b/pledges/prepare`, {
      method: "POST",
      token: plainUser,
      json: { amount: "1" },
    })).status,
    403,
  );
  h.close();
});

Deno.test("test pledge: never in the real vote", async () => {
  const { h } = await setup(real);
  const res = await h.req("/api/admin/vote-round/test-pledges/a/pledges/prepare", {
    method: "POST",
    token: await h.mint(ADMIN, true),
    json: { amount: "1" },
  });
  assertEquals(res.status, 409);
  h.close();
});

// ------------------------------------------------------------------ withdrawing
const withdraw = (h: Awaited<ReturnType<typeof harness>>, json: unknown, token: string) =>
  h.req("/api/admin/vote-round/withdraw", { method: "POST", token, json });
const msg = async (res: Response) => ((await j(res)) as { error: string }).error;

Deno.test("withdraw: a Safe batch for the round's contract, audited; admins with a recent sign-in only", async () => {
  const { h } = await qeSetup();
  const logs: string[] = [];
  h.deps.log = (line: string) => logs.push(line);
  assertEquals(
    (await withdraw(h, { slug: "b", withdrawn: true }, await h.mint(PLAIN))).status,
    403,
  );
  assertEquals(
    (await withdraw(h, { slug: "b", withdrawn: true }, await h.mint(ADMIN))).status,
    403,
  );
  const token = await h.mint(ADMIN, true);
  const res = await withdraw(h, { slug: "b", withdrawn: true }, token);
  assertEquals(res.status, 200);
  const batch = await j(res) as {
    chainId: string;
    transactions: { to: string; value: string; data: Hex }[];
  };
  assertEquals(batch.chainId, "11155111");
  assertEquals(batch.transactions.length, 1);
  assertEquals(batch.transactions[0].to, qe.contract);
  const call = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: batch.transactions[0].data });
  assertEquals([call.functionName, call.args], ["withdrawInitiative", [1n]]);
  const audit = logs.map((l) => JSON.parse(l)).filter((e) => e.securityAudit);
  assertEquals(audit.some((e) => e.action === "vote.withdraw" && e.outcome === "success"), true);
  h.close();
});

Deno.test("withdraw: undo is undoWithdrawInitiative, only for one withdrawn on-chain", async () => {
  const { h, state } = await qeSetup();
  const token = await h.mint(ADMIN, true);
  const notYet = await withdraw(h, { slug: "b", withdrawn: false }, token);
  assertEquals(notYet.status, 409);
  assertEquals(await msg(notYet), "This initiative isn't withdrawn.");
  state.states = [{ ...oneState([150n, 150n, 150n], 200n)[0], withdrawn: [false, true, false] }];
  h.clock.now += 10; // the round is read again every few seconds
  const fresh = await h.mint(ADMIN, true);
  const again = await withdraw(h, { slug: "b", withdrawn: true }, fresh);
  assertEquals(again.status, 409);
  assertEquals(await msg(again), "This initiative is already withdrawn.");
  const res = await withdraw(h, { slug: "b", withdrawn: false }, fresh);
  assertEquals(res.status, 200);
  const data = ((await j(res)) as { transactions: { data: Hex }[] }).transactions[0].data;
  const call = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data });
  assertEquals([call.functionName, call.args], ["undoWithdrawInitiative", [1n]]);
  h.close();
});

Deno.test("withdraw: a project settled or covered at a settlement is refused, with its tier", async () => {
  const { h } = await qeSetup([150n, 0n, 150n]);
  h.clock.now = NOW + 700; // S-Tier has settled: a funded, b covered
  const token = await h.mint(ADMIN, true);
  const funded = await withdraw(h, { slug: "a", withdrawn: true }, token);
  assertEquals(funded.status, 409);
  assertEquals(await msg(funded), "This initiative is settled in S-Tier; it can't be withdrawn.");
  const covered = await withdraw(h, { slug: "b", withdrawn: true }, token);
  assertEquals(covered.status, 409);
  assertEquals(await msg(covered), "This initiative is settled in S-Tier; it can't be withdrawn.");
  // The list says the same, for the page to disable the button.
  const list = await j(await h.req("/api/admin/vote-round/initiatives", { token })) as {
    initiatives: { slug: string; withdrawn: boolean; settledIn: string | null }[];
  };
  assertEquals(list.initiatives.map((x) => [x.slug, x.settledIn]), [
    ["a", "S"],
    ["b", "S"],
    ["c", null],
  ]);
  await h.settle();
  h.close();
});

Deno.test("withdraw: unknown slug is 404, a closed vote is 409, no round is 503", async () => {
  const { h } = await qeSetup();
  const token = await h.mint(ADMIN, true);
  assertEquals((await withdraw(h, { slug: "nope", withdrawn: true }, token)).status, 404);
  assertEquals((await withdraw(h, { slug: "a", withdrawn: "yes" }, token)).status, 400);
  h.clock.now = qe.closesAt;
  const closed = await withdraw(h, { slug: "c", withdrawn: true }, await h.mint(ADMIN, true));
  assertEquals(closed.status, 409);
  assertEquals(await msg(closed), "Voting has closed; nothing can be withdrawn now.");
  h.deps.vote = undefined;
  const none = await withdraw(h, { slug: "c", withdrawn: true }, await h.mint(ADMIN, true));
  assertEquals(none.status, 503);
  await h.settle();
  h.close();
});

Deno.test("withdraw: once every tier has settled (before the close) the tally is final: 409, and the list says so", async () => {
  const { h } = await qeSetup();
  h.clock.now = NOW + 800; // B-Tier settled at NOW + 780; the vote closes at NOW + 3600
  const token = await h.mint(ADMIN, true);
  const res = await withdraw(h, { slug: "c", withdrawn: true }, token);
  assertEquals(res.status, 409);
  assertEquals(
    await msg(res),
    "Every tier has settled: the vote's tally is final, nothing to withdraw from.",
  );
  const list = await j(await h.req("/api/admin/vote-round/initiatives", { token })) as {
    final: boolean;
    canWithdraw: boolean;
  };
  assertEquals([list.final, list.canWithdraw], [true, true]);
  await h.settle();
  h.close();
});

Deno.test("withdraw: a contract from before withdrawals is refused, and the list says so", async () => {
  const { h, chain } = await qeSetup();
  chain.canWithdraw = () => Promise.resolve(false);
  const token = await h.mint(ADMIN, true);
  const res = await withdraw(h, { slug: "c", withdrawn: true }, token);
  assertEquals(res.status, 409);
  assertEquals(await msg(res), "This round's contract predates withdrawals.");
  const list = await j(await h.req("/api/admin/vote-round/initiatives", { token })) as {
    final: boolean;
    canWithdraw: boolean;
  };
  assertEquals([list.final, list.canWithdraw], [false, false]);
  await h.settle();
  h.close();
});

// ------------------------------------------------------------------ the pool on-chain (#103)
const poolUsdReq = (h: Awaited<ReturnType<typeof harness>>, json: unknown, token: string) =>
  h.req("/api/admin/vote-round/pool-usd", { method: "POST", token, json });

Deno.test("pool on-chain: the contract's last PoolUsdSet, the live ETH price and the dates; admins only", async () => {
  const { h, state } = await setup();
  h.script.ethUsd = 1813.5;
  const get = (token: string) => h.req("/api/admin/vote-round/pool-usd", { token });
  assertEquals((await get(await h.mint(PLAIN))).status, 403);
  const token = await h.mint(ADMIN, true);
  // No PoolUsdSet read yet: the deploy's figure.
  assertEquals(await j(await get(token)), {
    poolUsd: "913244000000",
    ethUsd: 1813.5,
    lowerUntil: NOW + 600,
    closesAt: NOW + 3600,
  });
  state.history.pool = [
    { block: 1, logIndex: 0, poolUsd: 913_244_000_000n },
    { block: 9, logIndex: 2, poolUsd: 725_400_000_000n },
  ];
  assertEquals((await j(await get(token)) as { poolUsd: string }).poolUsd, "725400000000");
  h.close();
});

Deno.test("pool on-chain: no ETH price says so instead of failing", async () => {
  const { h } = await setup();
  h.script.brokenFeeds.add("ETH");
  const res = await h.req("/api/admin/vote-round/pool-usd", { token: await h.mint(ADMIN, true) });
  assertEquals((await j(res) as { ethUsd: number | null }).ethUsd, null);
  h.close();
});

Deno.test("pool on-chain: a setPoolUsd batch for the round's admin, in six decimals, audited", async () => {
  const { h } = await setup();
  const logs: string[] = [];
  h.deps.log = (line: string) => logs.push(line);
  assertEquals((await poolUsdReq(h, { usd: 725_400 }, await h.mint(ADMIN))).status, 403);
  const token = await h.mint(ADMIN, true);
  const res = await poolUsdReq(h, { usd: 725_400.5 }, token);
  assertEquals(res.status, 200);
  const batch = await j(res) as {
    chainId: string;
    meta: { name: string };
    transactions: { to: string; data: Hex }[];
  };
  assertEquals(batch.chainId, "11155111");
  assertEquals(batch.meta.name, "Set the vote's pool to $725,400.50");
  assertEquals(batch.transactions[0].to, manifest.contract);
  const call = decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: batch.transactions[0].data });
  assertEquals([call.functionName, call.args], ["setPoolUsd", [725_400_500_000n]]);
  const audit = logs.map((l) => JSON.parse(l)).filter((e) => e.securityAudit);
  assertEquals(audit.some((e) => e.action === "vote.pool_usd" && e.outcome === "success"), true);
  h.close();
});

Deno.test("pool on-chain: refusals (not a number, the same amount, lower after S-Tier's first tally, closed)", async () => {
  const { h, state } = await setup();
  const token = await h.mint(ADMIN, true);
  const refused = async (json: unknown, status: number, text: string) => {
    const res = await poolUsdReq(h, json, token);
    assertEquals(res.status, status);
    assertEquals(await msg(res), text);
  };
  await refused({ usd: "lots" }, 400, "The pool's dollars aren't a number.");
  await refused({ usd: -1 }, 400, "The pool's dollars aren't a number.");
  await refused({ usd: 913_244 }, 409, "The contract already holds $913,244.");
  // Before S-Tier's first tally it may go down (a correction); after it, only up.
  assertEquals((await poolUsdReq(h, { usd: 700_000 }, token)).status, 200);
  h.clock.now = NOW + 600;
  const later = await h.mint(ADMIN, true);
  const down = await poolUsdReq(h, { usd: 700_000 }, later);
  assertEquals(down.status, 409);
  assertEquals(
    await msg(down),
    "S-Tier's first tally has passed: the pool can only go up now (the contract holds $913,244).",
  );
  assertEquals((await poolUsdReq(h, { usd: 950_000 }, later)).status, 200);
  state.history.pool = [{ block: 9, logIndex: 0, poolUsd: 950_000_000_000n }];
  h.clock.now = NOW + 3600;
  const closed = await poolUsdReq(h, { usd: 990_000 }, await h.mint(ADMIN, true));
  assertEquals(closed.status, 409);
  assertEquals(await msg(closed), "Voting has closed; the pool can't change now.");
  h.close();
});
