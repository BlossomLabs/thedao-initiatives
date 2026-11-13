import { assertEquals } from "@std/assert";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex, type Hex, parseSignature, signatureToCompactSignature } from "viem";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { codeMessage, formatCode } from "../../shared/vote/code.ts";
import { encodeBallot } from "../../shared/vote/ballot.ts";
import { voteTypedData } from "../../shared/vote/typed-data.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { VoteChain } from "../services/vote-chain.ts";
import { cacheSet } from "../routes/vote.ts";

const ISSUER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
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
  issuer: ISSUER.address,
  slugs: ["a", "b", "c"],
  projects: ["a", "b", "c"].map(() => ({ askUsd: "1", rfp: false, groups: [] })),
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
  projects: ["a", "b", "c"].map(() => ({ askUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};

type Sent = Parameters<VoteChain["send"]>[0];

function fakeChain() {
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
    logs: [] as ({ tokenId: string; ballot: Hex; timestamp: number } | {
      tokenId: string;
      revoked: true;
      timestamp: number;
    })[],
    ballotReads: 0,
    txStatus: new Map<string, "pending" | "success" | "reverted" | "unknown">(),
    /** What the RPC says the relayer's pending nonce is (may lag). */
    chainNonce: 0,
    nonces_used: [] as number[],
    /** Voting-badge ids per lowercase address (the real round's index lookup). */
    badges: new Map<string, number[]>(),
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
      return Promise.resolve(state.logs);
    },
    rulesHistory: () => Promise.resolve(state.history),
  };
  return { state, chain };
}

async function setup(m: VoteManifest = manifest) {
  const h = await harness();
  const fake = fakeChain();
  // The relayer has gas unless a test says otherwise.
  fake.state.balances.set(RELAYER, 10n ** 18n);
  // Every initiative needs $100 unless a test says otherwise (the board isn't seeded).
  h.deps.vote = {
    chain: fake.chain,
    manifest: m,
    needs: () => Promise.resolve(m.slugs.map(() => 100_000_000n)),
  };
  h.clock.now = NOW;
  return { h, ...fake };
}

const code = async (n: number) =>
  formatCode(n, await ISSUER.signMessage({ message: codeMessage(n) }));

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

Deno.test("vote round code: valid, unclaimed", async () => {
  const { h } = await setup();
  const res = await h.req(`/api/vote/code/${await code(17)}`);
  assertEquals(res.status, 200);
  assertEquals(await j(res), { n: 17, claimed: false, owner: null });
  h.close();
});

Deno.test("vote round code: claimed shows the owner", async () => {
  const { h, state } = await setup();
  state.owners.set(17n, PLAIN);
  assertEquals(await j(await h.req(`/api/vote/code/${await code(17)}`)), {
    n: 17,
    claimed: true,
    owner: PLAIN,
  });
  h.close();
});

Deno.test("vote round code: mangled or foreign codes are a 400 bad_code, never a 500", async () => {
  const { h } = await setup();
  const foreign = formatCode(17, await OTHER.signMessage({ message: codeMessage(17) }));
  for (const bad of ["17", "abc", "0.xyz", foreign, (await code(17)).slice(0, -2)]) {
    const res = await h.req(`/api/vote/code/${encodeURIComponent(bad)}`);
    assertEquals(res.status, 400, bad);
    assertEquals((await j(res)).code, "bad_code");
  }
  h.close();
});

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

Deno.test("real round: no paper codes, no claims, no gas drip", async () => {
  const { h, state } = await setup(real);
  const token = await h.mint(PLAIN);
  state.owners.set(17n, PLAIN);
  const c = await code(1);
  for (
    const res of [
      await h.req(`/api/vote/code/${c}`),
      await h.req("/api/vote/claim", { method: "POST", token, json: { code: c } }),
      await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } }),
    ]
  ) assertEquals([res.status, (await j(res)).code], [404, "off"]);
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

Deno.test("vote round claim: mints token n to the session address", async () => {
  const { h, state } = await setup();
  const token = await h.mint(PLAIN);
  const res = await h.req("/api/vote/claim", {
    method: "POST",
    token,
    json: { code: await code(17) },
  });
  assertEquals(res.status, 200);
  assertEquals(typeof (await j(res)).hash, "string");
  assertEquals(state.sent, [{ fn: "mint", args: [PLAIN, 17n] }]);
  h.close();
});

Deno.test("vote round claim: needs a session", async () => {
  const { h } = await setup();
  const res = await h.req("/api/vote/claim", { method: "POST", json: { code: await code(17) } });
  assertEquals(res.status, 401);
  h.close();
});

Deno.test("vote round claim: refusals", async () => {
  const { h, state } = await setup();
  const token = await h.mint(PLAIN);
  const claim = async (c: string) => {
    const res = await h.req("/api/vote/claim", { method: "POST", token, json: { code: c } });
    return [res.status, (await j(res)).code];
  };
  assertEquals(await claim("nope"), [400, "bad_code"]);
  state.owners.set(17n, OTHER.address);
  assertEquals(await claim(await code(17)), [409, "claimed"]);
  state.owners.set(18n, PLAIN);
  assertEquals(await claim(await code(19)), [409, "one_per_person"]);
  state.owners.delete(18n);
  state.code.set(PLAIN.toLowerCase(), "0x6080604052");
  assertEquals(await claim(await code(19)), [422, "smart_wallet"]);
  state.code.clear();
  h.clock.now = manifest.closesAt;
  assertEquals(await claim(await code(19)), [410, "closed"]);
  assertEquals(state.sent, []);
  h.close();
});

Deno.test("vote round claim: two codes at once by one address mint once", async () => {
  const { h, state } = await setup();
  const token = await h.mint(PLAIN);
  let release!: () => void;
  state.slowSend = new Promise((r) => (release = r));
  const a = h.req("/api/vote/claim", { method: "POST", token, json: { code: await code(1) } });
  const b = h.req("/api/vote/claim", { method: "POST", token, json: { code: await code(2) } });
  await new Promise((r) => setTimeout(r, 20));
  release();
  const statuses = (await Promise.all([a, b])).map((r) => r.status).sort();
  assertEquals(statuses, [200, 409]);
  assertEquals(state.sent.length, 1);
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

Deno.test("vote round claim: an EIP-7702 wallet is a wallet; a contract wallet is not", async () => {
  const { h, state } = await setup();
  const token = await h.mint(PLAIN);
  state.code.set(PLAIN.toLowerCase(), `0xef0100${"ab".repeat(20)}`);
  const ok = await h.req("/api/vote/claim", {
    method: "POST",
    token,
    json: { code: await code(5) },
  });
  assertEquals(ok.status, 200);

  const other = await h.mint(OTHER.address);
  state.code.set(OTHER.address.toLowerCase(), "0x6080604052");
  const no = await h.req("/api/vote/claim", {
    method: "POST",
    token: other,
    json: { code: await code(6) },
  });
  assertEquals([no.status, (await j(no)).code], [422, "smart_wallet"]);
  h.close();
});

Deno.test("vote round claim: a 7702 wallet whose delegate can't take the badge is told so, nothing sent", async () => {
  const { h, state } = await setup();
  const token = await h.mint(PLAIN);
  state.code.set(PLAIN.toLowerCase(), `0xef0100${"ab".repeat(20)}`);
  state.unmintable.add(PLAIN.toLowerCase());
  const res = await h.req("/api/vote/claim", {
    method: "POST",
    token,
    json: { code: await code(5) },
  });
  assertEquals([res.status, (await j(res)).code], [422, "cannot_receive"]);
  assertEquals(state.sent, []);
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

Deno.test("vote round claim: a pending mint still blocks a second code and a second claimer", async () => {
  const { h, state } = await setup();
  state.mintsMine = false;
  const token = await h.mint(PLAIN);
  const other = await h.mint(OTHER.address);
  const claim = async (t: string, n: number) => {
    const res = await h.req("/api/vote/claim", {
      method: "POST",
      token: t,
      json: { code: await code(n) },
    });
    return [res.status, (await j(res)).code];
  };
  assertEquals((await claim(token, 1))[0], 200);
  assertEquals(await claim(token, 2), [409, "one_per_person"]);
  assertEquals(await claim(other, 1), [409, "claimed"]);
  assertEquals(state.sent.length, 1);
  h.close();
});

Deno.test("vote round claim: a reverted or dropped mint frees the code and the address", async () => {
  const { h, state } = await setup();
  state.mintsMine = false;
  const token = await h.mint(PLAIN);
  const first = await j(
    await h.req("/api/vote/claim", { method: "POST", token, json: { code: await code(1) } }),
  );
  state.txStatus.set(first.hash as string, "reverted");
  const retry = await h.req("/api/vote/claim", {
    method: "POST",
    token,
    json: { code: await code(1) },
  });
  assertEquals(retry.status, 200);
  assertEquals(state.sent.length, 2);
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

Deno.test("vote round ballots: once the close is final, the chain is read once and kept", async () => {
  const { h, state } = await setup();
  h.clock.now = manifest.closesAt + 60 * 60;
  await h.req("/api/vote/ballots");
  h.clock.now += 24 * 60 * 60;
  await h.req("/api/vote/ballots");
  assertEquals(state.ballotReads, 1);
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
  for (const [i, who] of [PLAIN, OTHER.address].entries()) {
    const token = await h.mint(who);
    const res = await h.req("/api/vote/claim", {
      method: "POST",
      token,
      json: { code: await code(i + 1) },
    });
    assertEquals(res.status, 200);
  }
  assertEquals(state.nonces_used, [0, 1]);
  state.chainNonce = 5; // the chain moved on (e.g. a manual tx): follow it
  const third = privateKeyToAccount(`0x${"44".repeat(32)}`).address;
  const token = await h.mint(third);
  await h.req("/api/vote/claim", { method: "POST", token, json: { code: await code(9) } });
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
  const claim = async (who: string, n: number) => {
    const token = await h.mint(who);
    return await h.req("/api/vote/claim", {
      method: "POST",
      token,
      json: { code: await code(n) },
    });
  };
  const first = await j(await claim(PLAIN, 1));
  // The node never saw it, and its pending count stays at 0.
  state.txStatus.set(first.hash as string, "unknown");
  await claim(OTHER.address, 2);
  assertEquals(state.nonces_used, [0, 1], "within a minute it may still arrive");
  state.txStatus.set(`0x${(2).toString(16).padStart(64, "0")}`, "unknown");
  h.clock.now += 61;
  await claim(privateKeyToAccount(`0x${"44".repeat(32)}`).address, 3);
  assertEquals(state.nonces_used, [0, 1, 0]);
  h.close();
});

Deno.test("vote round: a new round starts clean (gas, relay count and mint markers are per contract)", async () => {
  const { h, state } = await setup();
  state.mintsMine = false;
  state.owners.set(17n, PLAIN);
  const token = await h.mint(PLAIN);
  // Team test round: a mint of code 1 still pending, and badge 17's gas drip.
  const other = await h.mint(OTHER.address);
  const first = await h.req("/api/vote/claim", {
    method: "POST",
    token: other,
    json: { code: await code(1) },
  });
  assertEquals(first.status, 200);
  assertEquals(
    (await h.req("/api/vote/gas", { method: "POST", token, json: { tokenId: "17" } })).status,
    200,
  );

  // The public round: same codes and badge numbers, a new contract.
  const next = fakeChain();
  next.state.owners.set(17n, PLAIN);
  h.deps.vote = {
    chain: next.chain,
    manifest: { ...manifest, contract: "0x2000000000000000000000000000000000000002" },
  };
  const third = await h.mint(privateKeyToAccount(`0x${"44".repeat(32)}`).address);
  const claim = await h.req("/api/vote/claim", {
    method: "POST",
    token: third,
    json: { code: await code(1) },
  });
  assertEquals(claim.status, 200, "code 1 is unclaimed in the new round");
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

async function qeSetup(needs = [150n, 150n, 150n]) {
  const { h, state } = await setup(qe);
  const n = { needs };
  h.deps.vote!.needs = () => Promise.resolve(n.needs);
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  return { h, state, n };
}

Deno.test("the round lists each initiative's gap to the next tier", async () => {
  // Real-sized money: gaps are whole $1K steps, so a $200 pool could never reach one.
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  h.deps.vote!.needs = () => Promise.resolve([3_000_000_000n, 3_000_000_000n, 3_000_000_000n]);
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

Deno.test("round next: who it knocks out is named by slug", async () => {
  // $100K pool. Two voters back b ($40K) below c (out of anyone's reach), so b is funded
  // after the first tier. Backing a ($70K) to B-Tier's gap funds it first and leaves
  // too little for b.
  const { h, state } = await setup({ ...qe, poolUsd: "100000000000" });
  h.deps.vote!.needs = () => Promise.resolve([70_000_000_000n, 40_000_000_000n, 1n << 60n]);
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

Deno.test("round next: the same tally inputs are searched once", async () => {
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  h.deps.vote!.needs = () => Promise.resolve([3_000_000_000n, 3_000_000_000n, 3_000_000_000n]);
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

/** $6K pool, $3K needs; both voters back a alone, so the live tally funds a in S-Tier. */
async function leadSetup() {
  const { h, state } = await setup({ ...qe, poolUsd: "6000000000" });
  h.deps.vote!.needs = () => Promise.resolve([3_000_000_000n, 3_000_000_000n, 3_000_000_000n]);
  state.logs = [logOf("1", `01${X}${X}`, NOW - 100, 1), logOf("2", `01${X}${X}`, NOW - 90, 2)];
  return { h, state };
}
type LiveBody = { live: { next?: unknown; lead?: Record<string, string> } };

Deno.test("an open round serves S-Tier leads", async () => {
  const { h } = await leadSetup();
  // Like the gaps: the first read starts the work and doesn't wait for it.
  const first = await j(await h.req("/api/vote/round")) as LiveBody;
  assertEquals(first.live.lead, undefined);
  await h.settle();
  const body = await j(await h.req("/api/vote/round")) as LiveBody;
  assertEquals(body.live.next !== undefined, true);
  // The voters hold $6K and a costs $3K: its backers could pay $3K more and keep it.
  assertEquals(body.live.lead, { a: "3000000000" });
  await h.settle();
  h.close();
});

Deno.test("no leads once S-Tier has settled", async () => {
  const { h } = await leadSetup();
  h.clock.now = NOW + 700; // S settled at NOW + 660; A is open
  await h.req("/api/vote/round");
  await h.settle();
  h.clock.now += 10;
  const body = await j(await h.req("/api/vote/round")) as LiveBody;
  assertEquals(body.live.next !== undefined, true, "the search ran");
  assertEquals(body.live.lead, undefined);
  await h.settle();
  h.close();
});

/** A closed round. $10K pool. Both voters back a first, then b and c: a is funded in
 * S-Tier, b in A-Tier, and c needs more than what's left once a and b are paid, so it
 * never is. */
async function closedSetup() {
  const got = await setup({ ...qe, poolUsd: "10000000000" });
  const { h, state } = got;
  h.deps.vote!.needs = () => Promise.resolve([3_000_000_000n, 3_000_000_000n, 5_000_000_000n]);
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
  const entry = (await other.h.kv.get<{ body: unknown; finalKey?: string }>(roundKey)).value!;
  other.h.close();
  assertEquals(typeof entry.finalKey, "string");
  const here = await closedSetup();
  await here.h.kv.set(roundKey, entry);
  return { ...here, entry };
}

Deno.test("a closed round cached without its what-ifs replays once to start them", async () => {
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

Deno.test("a failed replay for the what-ifs serves the cached round, retried a minute on", async () => {
  const { h, state, chain, entry } = await closedCachedElsewhere();
  const ballots = chain.ballots;
  chain.ballots = () => {
    state.ballotReads++;
    return Promise.reject(new Error("RPC down"));
  };
  const first = await h.req("/api/vote/round");
  assertEquals(first.status, 200);
  assertEquals(await j(first), entry.body);
  assertEquals(state.ballotReads, 1);
  // Not tried again on every request.
  h.clock.now += 30;
  assertEquals((await h.req("/api/vote/round")).status, 200);
  assertEquals(state.ballotReads, 1);
  // A minute on it is tried again; once the chain answers, the search starts.
  chain.ballots = ballots;
  h.clock.now += 31;
  await h.req("/api/vote/round");
  assertEquals(state.ballotReads, 2);
  await h.settle();
  const done = await j(await h.req("/api/vote/round")) as { final?: unknown };
  assertEquals(done.final !== undefined, true);
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
  // The round itself is cached for good now; the what-ifs come with it.
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
  const { next: _next, ...live } = body.live as { next?: unknown };
  // Both badges rank only A: each would pay half of it, if S-Tier settled now.
  assertEquals(live, {
    funded: ["a"],
    awards: { a: "150" },
    tiers: { a: "S" },
    paid: { "1": { a: "75" }, "2": { a: "75" } },
  });
  assertEquals(body.registrationClosesAt, NOW + 660);
  assertEquals(body.accepted, { "1": `0x01${X}${X}`, "2": `0x01${X}${X}` });
  await h.settle();
  h.close();
});

Deno.test("round: S's settlement is kept only once the blocks before it are final", async () => {
  const { h, n } = await qeSetup();
  h.clock.now = NOW + 700; // settled at NOW + 660, but logs before it may still arrive
  await h.req("/api/vote/round");
  assertEquals(
    (await h.deps.db.kv.get(["vote", qe.contract.toLowerCase(), "settled", "S"])).value,
    null,
  );
  // A donation meanwhile doesn't move it: the needs it settled with are kept at once.
  n.needs = [10n, 10n, 10n];
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

Deno.test("round: a quiet window settles S; later need changes never move it", async () => {
  const { h, n } = await qeSetup();
  h.clock.now = NOW + 660 + 30 * 60;
  const first = await j(await h.req("/api/vote/round")) as { tiers: unknown[] };
  assertEquals(first.tiers[0], {
    tier: "S",
    status: "settled",
    at: NOW + 660,
    forced: false,
    funded: ["a"],
    awards: { a: "150" },
    paid: { "1": { a: "75" }, "2": { a: "75" } },
  });
  n.needs = [10n, 10n, 10n];
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

Deno.test("round: an initiative missing from the board holds the round instead of costing $0", async () => {
  const { h } = await qeSetup();
  h.deps.vote!.needs = undefined; // read the board, which has none of a, b, c
  const res = await h.req("/api/vote/round");
  assertEquals([res.status, (await j(res)).code], [503, "needs_unavailable"]);
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
  const key = ["vote", qe.contract.toLowerCase(), "settle-needs", "S"];
  assertEquals(
    (await j(await h.req("/api/vote/round")) as { tiers: { status: string }[] }).tiers[0].status,
    "settled",
  );
  assertEquals((await h.deps.db.kv.get<{ at: number }>(key)).value?.at, NOW + 660);
  // A ballot inside S's window that the RPC hadn't returned: S changed after all.
  state.logs.push(logOf("2", `${X}01${X}`, NOW + 610, 3));
  h.clock.now += 10;
  const again = await j(await h.req("/api/vote/round")) as { tiers: { status: string }[] };
  assertEquals(again.tiers[0].status, "settled"); // maxWindows 1: forced at the same cutoff
  // Pinned for good only once final: then today's needs and late logs can't move it.
  h.clock.now = NOW + 660 + 30 * 60;
  await h.req("/api/vote/round");
  assertEquals((await h.deps.db.kv.get<{ at: number; forced: boolean }>(key)).value?.forced, true);
  await h.settle();
  h.close();
});

// ---------------------------------------------------------------- ballot rules
/** A round deployed with the ballot rules: four unrelated projects asking $100, pool $200. */
const ruled: VoteManifest = {
  ...manifest,
  poolUsd: "200",
  slugs: ["a", "b", "c", "d"],
  projects: ["a", "b", "c", "d"].map(() => ({ askUsd: "100", rfp: false, groups: [] })),
  ballotRules: true,
};

Deno.test("round: an invalid ballot shows as refused with invalid_ballot", async () => {
  const { h, state } = await setup(ruled);
  state.logs = [
    logOf("1", "01010101", NOW - 100, 1), // S-Tier = a, b, c, d: valid
    logOf("2", `01${X}${X}${X}`, NOW - 90, 2), // S-Tier = a alone: invalid
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

Deno.test("round: the pool the chain raised judges later ballots", async () => {
  const { h, state } = await setup(ruled);
  // Raised after ballot 1 (block 1) and before ballot 2 (block 2).
  state.history = { addedAt: [], pool: [{ block: 1, logIndex: 5, poolUsd: 1_000n }] };
  state.logs = [
    logOf("1", "01010101", NOW - 100, 1), // 400 ≥ 1.5 × 200
    logOf("2", "01010101", NOW - 90, 2), // 400 < 1.5 × 1,000
  ];
  const body = await j(await h.req("/api/vote/round")) as {
    accepted: Record<string, string>;
    poolUsd: string;
  };
  assertEquals(Object.keys(body.accepted), ["1"]);
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
  const body = await signedBallot(VOTER, 17n, 1n, "0x01010101", ruled);
  const res = await h.req("/api/vote/ballot", { method: "POST", json: body });
  assertEquals(res.status, 422);
  const out = await j(res) as { errors: Record<string, unknown>[] };
  assertEquals(out.errors, [{ rule: "size", requested: "400", needed: "1500", pool: "1000" }]);
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

Deno.test("round: held while the chain has a project this site doesn't know yet", async () => {
  const { h, state } = await setup(ruled);
  // The admin added a fifth project; the manifest (and so the replay) still has four.
  state.history.addedAt = [null, null, null, null, { block: 5, logIndex: 0 }];
  const res = await h.req("/api/vote/round");
  assertEquals(res.status, 503);
  assertEquals((await j(res)).code, "round_out_of_date");
  h.close();
});
