import { describe, expect, it, vi } from "vitest";
import { type Hex, keccak256 } from "viem";
import type { VoteManifest } from "../../shared/vote/manifest";
import {
  type BallotPhase,
  type FlowDeps,
  retryBallot,
  selfSendBallot,
  submitBallot,
} from "./vote-flow";

const m: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: 0,
  closesAt: 2_000_000_000,

  schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
  poolUsd: "913244000000",
  slugs: ["a", "b", "c", "d"],
  projects: ["a", "b", "c", "d"].map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
};
const VOTER: Hex = "0x3000000000000000000000000000000000000003";
/** S-Tier = a, b, c (unrelated): its proof is [0, 1, 2]. */
const BALLOT: Hex = "0x010101ff";
const PROOF = [0, 1, 2];
const SIG: Hex = `0x${"ab".repeat(65)}`;
const HASH: Hex = `0x${"cd".repeat(32)}`;
const OWN: Hex = `0x${"ef".repeat(32)}`;
const GAS: Hex = `0x${"99".repeat(32)}`;

function deps(over: Partial<FlowDeps> = {}) {
  const d: FlowDeps = {
    ensureChain: vi.fn(() => Promise.resolve()),
    isContractOwner: vi.fn(() => Promise.resolve(false)),
    sendDirect: vi.fn(() => Promise.resolve(OWN)),
    signVote: vi.fn(() => Promise.resolve(SIG)),
    relay: vi.fn(() => Promise.resolve(HASH)),
    nonceOf: vi.fn(() => Promise.resolve(0n)),
    ballotHashOf: vi.fn(() => Promise.resolve(`0x${"00".repeat(32)}` as Hex)),
    waitResult: vi.fn(() => Promise.resolve("recorded" as const)),
    requestGas: vi.fn(() => Promise.resolve(null)),
    waitTx: vi.fn(() => Promise.resolve()),
    sendOwn: vi.fn(() => Promise.resolve(OWN)),
    ...over,
  };
  return d;
}
const record = () => {
  const phases: BallotPhase[] = [];
  return { phases, set: (p: BallotPhase) => phases.push(p) };
};

describe("submitBallot", () => {
  it("switches chain, signs the next nonce, relays, waits, then counts", async () => {
    const d = deps({ nonceOf: vi.fn(() => Promise.resolve(2n)) });
    const { phases, set } = record();
    const signed = await submitBallot(d, m, 7n, VOTER, BALLOT, set);
    expect(d.ensureChain).toHaveBeenCalled();
    expect(d.signVote).toHaveBeenCalledWith(
      expect.objectContaining({
        message: { tokenId: 7n, voter: VOTER, nonce: 3n, ballot: BALLOT },
      }),
    );
    expect(d.relay).toHaveBeenCalledWith({
      tokenId: 7n,
      nonce: 3n,
      ballot: BALLOT,
      signature: SIG,
    });
    expect(d.waitResult).toHaveBeenCalledWith(HASH, { tokenId: 7n, nonce: 3n, ballot: BALLOT });
    expect(phases.map((p) => p.kind)).toEqual(["signing", "relaying", "waiting", "recorded"]);
    expect(signed).toEqual({ tokenId: 7n, nonce: 3n, ballot: BALLOT, signature: SIG, hash: HASH });
  });

  it("a declined signature goes back to idle, not failed", async () => {
    const { phases, set } = record();
    await submitBallot(
      deps({ signVote: () => Promise.reject(new Error("User rejected")) }),
      m,
      7n,
      VOTER,
      BALLOT,
      set,
    );
    expect(phases.at(-1)).toEqual({ kind: "idle", note: "You didn't sign, so nothing was sent." });
  });

  it("a relay error fails with retry possible", async () => {
    const { phases, set } = record();
    await submitBallot(
      deps({ relay: () => Promise.reject(new Error("busy")) }),
      m,
      7n,
      VOTER,
      BALLOT,
      set,
    );
    expect(phases.at(-1)).toMatchObject({ kind: "failed" });
  });

  it("reverted and mismatched results", async () => {
    for (
      const [result, kind] of [["reverted", "failed"], ["mismatch", "failed"]] as const
    ) {
      const { phases, set } = record();
      await submitBallot(
        deps({ waitResult: () => Promise.resolve(result) }),
        m,
        7n,
        VOTER,
        BALLOT,
        set,
      );
      expect(phases.at(-1)?.kind).toBe(kind);
    }
  });

  it("a wait that times out fails with the hash kept", async () => {
    const { phases, set } = record();
    await submitBallot(
      deps({ waitResult: () => Promise.reject(new Error("timeout")) }),
      m,
      7n,
      VOTER,
      BALLOT,
      set,
    );
    expect(phases.at(-1)).toMatchObject({ kind: "failed", hash: HASH });
  });
});

describe("retryBallot", () => {
  const last = { tokenId: 7n, nonce: 3n, ballot: BALLOT, signature: SIG, hash: HASH };

  it("the earlier transaction already landed: recorded, nothing sent again", async () => {
    const d = deps({
      nonceOf: vi.fn(() => Promise.resolve(3n)),
      ballotHashOf: vi.fn(() => Promise.resolve(keccak256(BALLOT))),
    });
    const { phases, set } = record();
    await retryBallot(d, m, VOTER, last, set);
    expect(d.relay).not.toHaveBeenCalled();
    expect(d.signVote).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ kind: "recorded", hash: HASH });
  });

  it("nothing landed: resends the same signature", async () => {
    const d = deps({ nonceOf: vi.fn(() => Promise.resolve(2n)) });
    const { phases, set } = record();
    await retryBallot(d, m, VOTER, last, set);
    expect(d.signVote).not.toHaveBeenCalled();
    expect(d.relay).toHaveBeenCalledWith({
      tokenId: 7n,
      nonce: 3n,
      ballot: BALLOT,
      signature: SIG,
    });
    expect(phases.at(-1)?.kind).toBe("recorded");
  });

  it("another ballot took that nonce: signs again for the next one", async () => {
    const d = deps({
      nonceOf: vi.fn(() => Promise.resolve(3n)),
      ballotHashOf: vi.fn(() => Promise.resolve(keccak256("0xff01"))),
    });
    const { set } = record();
    await retryBallot(d, m, VOTER, last, set);
    expect(d.signVote).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ nonce: 4n }) }),
    );
  });
});

describe("selfSendBallot", () => {
  it("fresh: signs, gets gas once, waits for it, sends from the wallet, then checks", async () => {
    const d = deps({
      nonceOf: vi.fn(() => Promise.resolve(0n)),
      requestGas: vi.fn(() => Promise.resolve(GAS)),
    });
    const { phases, set } = record();
    const out = await selfSendBallot(d, m, 7n, VOTER, BALLOT, null, set);
    expect(d.signVote).toHaveBeenCalled();
    expect(d.requestGas).toHaveBeenCalledWith(7n);
    expect(d.waitTx).toHaveBeenCalledWith(GAS);
    expect(d.sendOwn).toHaveBeenCalledWith(
      { tokenId: 7n, nonce: 1n, ballot: BALLOT, signature: SIG },
      PROOF,
    );
    expect(d.relay).not.toHaveBeenCalled();
    expect(d.waitResult).toHaveBeenCalledWith(OWN, { tokenId: 7n, nonce: 1n, ballot: BALLOT });
    expect(phases.at(-1)).toEqual({ kind: "recorded", hash: OWN });
    expect(out?.hash).toBe(OWN);
  });

  it("after a failed relay: reuses the signature when its nonce is still next", async () => {
    const d = deps({ nonceOf: vi.fn(() => Promise.resolve(2n)) });
    const last = { tokenId: 7n, nonce: 3n, ballot: BALLOT, signature: SIG, hash: HASH };
    const { set } = record();
    await selfSendBallot(d, m, 7n, VOTER, BALLOT, last, set);
    expect(d.signVote).not.toHaveBeenCalled();
    expect(d.sendOwn).toHaveBeenCalledWith(
      { tokenId: 7n, nonce: 3n, ballot: BALLOT, signature: SIG },
      PROOF,
    );
  });

  it("another badge's last ballot is never reused, even when the nonces line up", async () => {
    const d = deps({ nonceOf: vi.fn(() => Promise.resolve(0n)) });
    const last = { tokenId: 12n, nonce: 1n, ballot: BALLOT, signature: SIG, hash: HASH };
    const { set } = record();
    await selfSendBallot(d, m, 40n, VOTER, BALLOT, last, set);
    expect(d.signVote).toHaveBeenCalled();
    expect(d.sendOwn).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: 40n, nonce: 1n }),
      PROOF,
    );
  });

  it("the proof comes from the manifest's groups, whatever the asks", async () => {
    // a and b share a group: S-Tier a, b, c, d proves with a, c, d.
    const grouped: VoteManifest = {
      ...m,
      projects: m.projects.map((p, i) => ({ ...p, groups: i < 2 ? [0] : [] })),
      groups: ["Same team"],
    };
    const d = deps();
    const { set } = record();
    await selfSendBallot(d, grouped, 7n, VOTER, "0x01010101", null, set);
    expect(d.sendOwn).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 7n }), [0, 2, 3]);
  });

  it("a ballot with no unrelated triple in S-Tier sends no proof", async () => {
    const d = deps();
    const { set } = record();
    await selfSendBallot(d, m, 7n, VOTER, "0x0101ffff", null, set);
    expect(d.sendOwn).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 7n }), []);
  });

  it("no gas to be had (already given) still lets the wallet try", async () => {
    const d = deps({ requestGas: vi.fn(() => Promise.reject(new Error("already got its gas"))) });
    const { phases, set } = record();
    await selfSendBallot(d, m, 7n, VOTER, BALLOT, null, set);
    expect(d.sendOwn).toHaveBeenCalled();
    expect(phases.at(-1)?.kind).toBe("recorded");
  });

  it("a wallet that refuses the transaction goes back to idle", async () => {
    const d = deps({
      sendOwn: vi.fn(() => Promise.reject(new Error("User rejected the request"))),
    });
    const { phases, set } = record();
    await selfSendBallot(d, m, 7n, VOTER, BALLOT, null, set);
    expect(phases.at(-1)).toEqual({
      kind: "idle",
      note: "You didn't confirm, so nothing was sent.",
    });
  });
});

it("a contract owner self-sends and retries without an EOA signature", async () => {
  const d = deps({ isContractOwner: vi.fn(() => Promise.resolve(true)) });
  const { set } = record();
  const last = await selfSendBallot(d, m, 7n, VOTER, BALLOT, null, set);
  expect(d.signVote).not.toHaveBeenCalled();
  expect(d.sendOwn).not.toHaveBeenCalled();
  expect(d.sendDirect).toHaveBeenCalledWith({
    tokenId: 7n,
    nonce: 1n,
    ballot: BALLOT,
    signature: "0x",
    direct: true,
  }, PROOF);
  await retryBallot(d, m, VOTER, last!, set);
  expect(d.sendDirect).toHaveBeenCalledTimes(2);
  expect(d.relay).not.toHaveBeenCalled();
  expect(d.signVote).not.toHaveBeenCalled();
});

it("a contract owner declining the chain switch never submits the direct vote", async () => {
  const d = deps({
    isContractOwner: vi.fn(() => Promise.resolve(true)),
    ensureChain: vi.fn(() => Promise.reject(new Error("User rejected switch"))),
  });
  await selfSendBallot(d, m, 7n, VOTER, BALLOT, null, record().set);
  expect(d.sendDirect).not.toHaveBeenCalled();
  expect(d.requestGas).not.toHaveBeenCalled();
});
