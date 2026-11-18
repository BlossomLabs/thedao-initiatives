import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import {
  type BallotAddDeps,
  type BallotPhase,
  blockerText,
  isDuplicateInitiative,
  prepareInRound,
  putOnBallot,
} from "./ballot-add";
import type { ReadyJson } from "./api-types";
import { dayTime } from "./format";
import { ApiError } from "./api";

const HASH = ("0x" + "ab".repeat(32)) as Hex;

const ready: ReadyJson = {
  id: "rfp1",
  slug: "audits",
  title: "Audits",
  goalUsd: 10_000,
  raisedUsd: 6_000,
  safeAddress: "0x1000000000000000000000000000000000000001",
  type: "grant",
  affiliations: ["Acme"],
  pledges: [
    { pid: "01JPLEDGE0000000000000000A", company: "Acme", amountUsd: 1_000 },
    { pid: "01JPLEDGE0000000000000000B", company: "Beta", amountUsd: 2_000 },
  ],
  blocker: null,
  claim: null,
};

function deps(over: Partial<BallotAddDeps> = {}): BallotAddDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    claim: vi.fn(() => {
      log.push("claim");
      return Promise.resolve("ok" as const);
    }),
    release: vi.fn(() => {
      log.push("release");
      return Promise.resolve();
    }),
    plan: () => [
      { fn: "addGroup", args: ["0x00"] },
      { fn: "addInitiative", args: [ready.safeAddress, 10_000_000_000n, false, 1n] },
    ],
    send: vi.fn((call) => {
      log.push(`send ${call.fn}`);
      return Promise.resolve(HASH);
    }),
    waitReceipt: vi.fn(() => {
      log.push("receipt");
      return Promise.resolve("success" as const);
    }),
    inRound: vi.fn(() => {
      log.push("inRound");
      return Promise.resolve(log.filter((l) => l === "inRound").length >= 2);
    }),
    signPledge: vi.fn((pid: string) => {
      log.push(`sign ${pid.slice(-1)}`);
      return Promise.resolve("saved" as const);
    }),
    sleep: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

describe("putOnBallot", () => {
  it("putOnBallot: adds, waits for the round, then signs each pledge", async () => {
    const d = deps();
    const phases: BallotPhase[] = [];
    const end = await putOnBallot(d, ready, (p) => phases.push(p));
    expect(end).toEqual({ kind: "done" });
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(d.signPledge).toHaveBeenCalledTimes(2);
    // The claim is renewed before each send and each signature, so a long run keeps it.
    expect(d.log).toEqual([
      "claim",
      "claim",
      "send addGroup",
      "receipt",
      "claim",
      "send addInitiative",
      "receipt",
      "inRound",
      "inRound",
      "claim",
      "sign A",
      "claim",
      "sign B",
      "release",
    ]);
    expect(phases.map((p) => p.kind)).toEqual([
      "adding",
      "adding",
      "adding",
      "adding",
      "waiting-round",
      "signing",
      "signing",
      "done",
    ]);
    expect(phases[0]).toEqual({ kind: "adding", step: 1, of: 2 });
    expect(phases[1]).toEqual({ kind: "adding", step: 1, of: 2, hash: HASH });
    expect(phases.filter((p) => p.kind === "signing")).toEqual([
      { kind: "signing", done: 0, of: 2 },
      { kind: "signing", done: 1, of: 2 },
    ]);
    expect(d.sleep).toHaveBeenCalledWith(3_000);
  });

  it("putOnBallot: a reverted add stops before any signature", async () => {
    const d = deps({ waitReceipt: vi.fn(() => Promise.resolve("reverted" as const)) });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toMatchObject({ kind: "failed", added: false });
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.signPledge).not.toHaveBeenCalled();
  });

  it("putOnBallot: a declined transaction adds nothing", async () => {
    const d = deps({
      send: vi.fn(() => Promise.reject(new Error("User rejected the request."))),
    });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason: "You didn't send it, so nothing was added.",
      added: false,
    });
  });

  it("putOnBallot: an affiliation that landed before a declined add is said so", async () => {
    let n = 0;
    const d = deps({
      send: vi.fn(() =>
        n++ === 0 ? Promise.resolve(HASH) : Promise.reject(new Error("User rejected the request."))
      ),
    });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason:
        "The affiliation was added, but the initiative wasn't. Press Put on the ballot again.",
      added: false,
    });
  });

  it("putOnBallot: plans from the round read afresh, and nothing to add goes on to sign", async () => {
    const d = deps({ plan: vi.fn(() => Promise.resolve([])) });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({ kind: "done" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.signPledge).toHaveBeenCalledTimes(2);
  });

  it("putOnBallot: a failed signature after the add ends failed with added: true", async () => {
    const d = deps({ signPledge: vi.fn(() => Promise.resolve("failed" as const)) });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toMatchObject({ kind: "failed", added: true });
    // The first refusal stops it: the rest wait in Pledges to sign.
    expect(d.signPledge).toHaveBeenCalledTimes(1);
  });

  it("putOnBallot: the site not seeing it within 2 minutes ends failed with added: true", async () => {
    const d = deps({ inRound: vi.fn(() => Promise.resolve(false)) });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason:
        "The add landed but the site hasn't seen it yet. Reload in a minute; the pledges will be in Pledges to sign.",
      added: true,
    });
    expect(d.inRound).toHaveBeenCalledTimes(40);
    expect(d.signPledge).not.toHaveBeenCalled();
  });

  it("putOnBallot: with no pledges it is done once in the round", async () => {
    const d = deps({ inRound: vi.fn(() => Promise.resolve(true)) });
    const end = await putOnBallot(d, { ...ready, pledges: [] }, () => {});
    expect(end).toEqual({ kind: "done" });
    expect(d.signPledge).not.toHaveBeenCalled();
  });
});

describe("putOnBallot: one admin at a time", () => {
  const DUPLICATE = Object.assign(
    new Error('The contract function "addInitiative" reverted.\n\nError: DuplicateInitiative()'),
    { name: "ContractFunctionExecutionError" },
  );

  it("putOnBallot: another admin's claim ends it before anything is planned or sent", async () => {
    const plan = vi.fn(() => []);
    const d = deps({
      claim: vi.fn(() => Promise.resolve({ by: "0x1234…abcd" })),
      plan,
    });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason: "0x1234…abcd is already putting it on the ballot.",
      added: false,
    });
    expect(plan).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.signPledge).not.toHaveBeenCalled();
  });

  it("putOnBallot: past the deadline to qualify the server's refusal is said as it is", async () => {
    const plan = vi.fn(() => []);
    const closed = new ApiError(409, "No more initiatives can be added to the ballot.", {
      code: "ballot_closed",
    });
    const d = deps({ claim: vi.fn(() => Promise.reject(closed)), plan });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason: "No more initiatives can be added to the ballot.",
      added: false,
    });
    expect(plan).not.toHaveBeenCalled();
  });

  it("putOnBallot: a renewal another admin took over stops the run before the next send", async () => {
    let n = 0;
    const d = deps({
      claim: vi.fn(() => Promise.resolve(++n < 3 ? "ok" as const : { by: "0x2222…2222" })),
    });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason: "0x2222…2222 is already putting it on the ballot.",
      added: false,
    });
    // The addGroup went out; the addInitiative never did.
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.signPledge).not.toHaveBeenCalled();
  });

  it("putOnBallot: a renewal taken over after the add says it was added", async () => {
    let n = 0;
    const d = deps({
      // Claim, renew before both adds, renew before pledge A, then lost before pledge B.
      claim: vi.fn(() => Promise.resolve(++n < 5 ? "ok" as const : { by: "0x2222…2222" })),
    });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({
      kind: "failed",
      reason: "0x2222…2222 is already putting it on the ballot.",
      added: true,
    });
    expect(d.signPledge).toHaveBeenCalledTimes(1);
  });

  it("putOnBallot: a renewal that can't be sent doesn't stop the run", async () => {
    let n = 0;
    const d = deps({
      claim: vi.fn(() =>
        ++n === 1 ? Promise.resolve("ok" as const) : Promise.reject(new Error("offline"))
      ),
    });
    expect(await putOnBallot(d, ready, () => {})).toEqual({ kind: "done" });
  });

  it("putOnBallot: the claim is released whatever the outcome", async () => {
    const outcomes: Partial<BallotAddDeps>[] = [
      {},
      { plan: vi.fn(() => Promise.reject(new Error("The round couldn't be read."))) },
      { send: vi.fn(() => Promise.reject(new Error("User rejected the request."))) },
      { waitReceipt: vi.fn(() => Promise.resolve("reverted" as const)) },
      { inRound: vi.fn(() => Promise.resolve(false)) },
      { signPledge: vi.fn(() => Promise.resolve("failed" as const)) },
      { signPledge: vi.fn(() => Promise.reject(new Error("boom"))) },
    ];
    for (const over of outcomes) {
      const d = deps(over);
      await putOnBallot(d, ready, () => {});
      expect(d.release).toHaveBeenCalledTimes(1);
      expect(d.log.at(-1)).toBe("release");
    }
  });

  it("putOnBallot: a claim that can't be read ends it without sending", async () => {
    const d = deps({ claim: vi.fn(() => Promise.reject(new Error("Voting has closed."))) });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toEqual({ kind: "failed", reason: "Voting has closed.", added: false });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("putOnBallot: an addInitiative refused as DuplicateInitiative goes on to sign", async () => {
    const d = deps({
      plan: () => [{ fn: "addInitiative", args: [] }],
      send: vi.fn(() => Promise.reject(DUPLICATE)),
    });
    const phases: BallotPhase[] = [];
    const end = await putOnBallot(d, ready, (p) => phases.push(p));
    expect(end).toEqual({ kind: "done" });
    expect(phases).toContainEqual({ kind: "waiting-round", already: true });
    expect(d.signPledge).toHaveBeenCalledTimes(2);
  });

  it("putOnBallot: a reverted addInitiative that turns out a DuplicateInitiative goes on to sign", async () => {
    const d = deps({
      plan: () => [{ fn: "addInitiative", args: [] }],
      waitReceipt: vi.fn(() => Promise.reject(DUPLICATE)),
    });
    const phases: BallotPhase[] = [];
    const end = await putOnBallot(d, ready, (p) => phases.push(p));
    expect(end).toEqual({ kind: "done" });
    expect(phases).toContainEqual({ kind: "waiting-round", already: true });
    expect(d.signPledge).toHaveBeenCalledTimes(2);
  });

  it("putOnBallot: a DuplicateInitiative from an addGroup is still a failure", async () => {
    const d = deps({
      plan: () => [{ fn: "addGroup", args: [] }],
      send: vi.fn(() => Promise.reject(DUPLICATE)),
    });
    const end = await putOnBallot(d, ready, () => {});
    expect(end).toMatchObject({ kind: "failed", added: false });
    expect(d.signPledge).not.toHaveBeenCalled();
  });

  it("isDuplicateInitiative: reads viem's decoded error name or the message", () => {
    expect(isDuplicateInitiative(DUPLICATE)).toBe(true);
    const decoded = Object.assign(new Error("reverted"), {
      walk: (fn: (e: unknown) => boolean) =>
        [{ data: { errorName: "DuplicateInitiative" } }].find(fn),
    });
    expect(isDuplicateInitiative(decoded)).toBe(true);
    expect(isDuplicateInitiative(new Error("User rejected the request."))).toBe(false);
  });
});

describe("blockerText", () => {
  it("says why an initiative can't be added now", () => {
    expect(blockerText({ kind: "no-safe" })).toBe("Add a Safe first.");
    expect(blockerText({ kind: "safe-used" })).toBe(
      "Another initiative in the round uses this Safe.",
    );
    expect(blockerText({ kind: "rfp-affiliations" })).toBe("An RFP can't have affiliations.");
    expect(blockerText({ kind: "closed", opensAt: 1_800_000_000 })).toBe(
      `Opens again ${dayTime(1_800_000_000)}.`,
    );
    expect(blockerText({ kind: "closed", opensAt: null })).toBe("The vote is over.");
    expect(blockerText({ kind: "already" })).toBeNull();
    expect(blockerText(null)).toBeNull();
  });
});

describe("prepareInRound", () => {
  const notInRound = (e: unknown) => e instanceof Error && e.message === "404";
  it("prepareInRound: a 404 right after the add is tried again every 2 s until it answers", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    let n = 0;
    const prepare = vi.fn(() => ++n < 3 ? Promise.reject(new Error("404")) : Promise.resolve("ok"));
    expect(await prepareInRound(prepare, sleep, notInRound)).toBe("ok");
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2_000], [2_000]]);
  });
  it("prepareInRound: gives up after 10 s of 404s", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const prepare = vi.fn(() => Promise.reject(new Error("404")));
    await expect(prepareInRound(prepare, sleep, notInRound)).rejects.toThrow("404");
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(prepare).toHaveBeenCalledTimes(6);
  });
  it("prepareInRound: any other failure is not tried again", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const prepare = vi.fn(() => Promise.reject(new Error("409")));
    await expect(prepareInRound(prepare, sleep, notInRound)).rejects.toThrow("409");
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
