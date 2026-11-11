import { assertEquals } from "@std/assert";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex, type Hex, parseSignature, signatureToCompactSignature } from "viem";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { codeMessage, formatCode } from "../../shared/vote/code.ts";
import { encodeBallot } from "../../shared/vote/ballot.ts";
import { voteTypedData } from "../../shared/vote/typed-data.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { VoteChain } from "../services/vote-chain.ts";

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
};

type Sent = Parameters<VoteChain["send"]>[0];

function fakeChain() {
  const state = {
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
  };
  return { state, chain };
}

async function setup(m: VoteManifest = manifest) {
  const h = await harness();
  const fake = fakeChain();
  // The relayer has gas unless a test says otherwise.
  fake.state.balances.set(RELAYER, 10n ** 18n);
  h.deps.vote = { chain: fake.chain, manifest: m };
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
    args: [[{ tokenId: 17n, nonce: 1n, r, vs: yParityAndS, ballot: BALLOT }]],
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
  assertEquals(body.live, { funded: ["a"], awards: { a: "150" }, tiers: { a: "S" } });
  assertEquals(body.registrationClosesAt, NOW + 660);
  assertEquals(body.accepted, { "1": `0x01${X}${X}`, "2": `0x01${X}${X}` });
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
  });
  n.needs = [10n, 10n, 10n];
  h.clock.now += 10;
  const later = await j(await h.req("/api/vote/round")) as { tiers: { awards: unknown }[] };
  assertEquals(later.tiers[0].awards, { a: "150" });
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
  assertEquals([moved.status, (await j(moved)).code], [409, "tier_settled"]);
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
