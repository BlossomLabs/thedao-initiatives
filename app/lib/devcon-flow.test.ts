import { describe, expect, it, vi } from "vitest";
import { type Hex, keccak256 } from "viem";
import type { DevconManifest } from "../../shared/devcon/manifest";
import { type BallotPhase, type FlowDeps, retryBallot, submitBallot } from "./devcon-flow";

const m: DevconManifest = {
  chainId: 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  deployBlock: 1,
  opensAt: 0,
  closesAt: 2_000_000_000,
  poolUsd: "913244000000",
  issuer: "0x2000000000000000000000000000000000000002",
  slugs: ["a", "b"],
};
const VOTER: Hex = "0x3000000000000000000000000000000000000003";
const BALLOT: Hex = "0x01ff";
const SIG: Hex = `0x${"ab".repeat(65)}`;
const HASH: Hex = `0x${"cd".repeat(32)}`;

function deps(over: Partial<FlowDeps> = {}) {
  const d: FlowDeps = {
    ensureSepolia: vi.fn(() => Promise.resolve()),
    signVote: vi.fn(() => Promise.resolve(SIG)),
    relay: vi.fn(() => Promise.resolve(HASH)),
    nonceOf: vi.fn(() => Promise.resolve(0n)),
    ballotHashOf: vi.fn(() => Promise.resolve(`0x${"00".repeat(32)}` as Hex)),
    waitResult: vi.fn(() => Promise.resolve("counted" as const)),
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
    expect(d.ensureSepolia).toHaveBeenCalled();
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
    expect(phases.map((p) => p.kind)).toEqual(["signing", "relaying", "waiting", "counted"]);
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

  it("reverted, mismatched and late results", async () => {
    for (
      const [result, kind] of [["reverted", "failed"], ["mismatch", "failed"], [
        "late",
        "late",
      ]] as const
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

  it("the earlier transaction already landed: counted, nothing sent again", async () => {
    const d = deps({
      nonceOf: vi.fn(() => Promise.resolve(3n)),
      ballotHashOf: vi.fn(() => Promise.resolve(keccak256(BALLOT))),
    });
    const { phases, set } = record();
    await retryBallot(d, m, VOTER, last, set);
    expect(d.relay).not.toHaveBeenCalled();
    expect(d.signVote).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ kind: "counted", hash: HASH });
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
    expect(phases.at(-1)?.kind).toBe("counted");
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
