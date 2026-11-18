import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { type PledgeFlowDeps, type PledgePhase, sendPledge } from "./pledge-flow";

const HASH: Hex = `0x${"cd".repeat(32)}`;
const EARLIER: Hex = `0x${"ee".repeat(32)}`;
const SIG: Hex = `0x${"ab".repeat(65)}`;
const PREP = { pid: "P1" };

function deps(over: Partial<PledgeFlowDeps<typeof PREP>> = {}) {
  const d: PledgeFlowDeps<typeof PREP> = {
    chain: "Ethereum",
    plain: vi.fn(() => Promise.resolve("sign" as const)),
    prepare: vi.fn(() => Promise.resolve(PREP)),
    sign: vi.fn(() => Promise.resolve(SIG)),
    send: vi.fn(() => Promise.resolve({ hash: HASH, pid: "P1" })),
    waitReceipt: vi.fn(() => Promise.resolve("success" as const)),
    settle: vi.fn(() => Promise.resolve("saved" as const)),
    sleep: vi.fn(() => Promise.resolve()),
    ...over,
  };
  return d;
}
const record = () => {
  const phases: PledgePhase[] = [];
  return {
    phases,
    set: (p: PledgePhase) => phases.push(p),
    kinds: () => phases.map((p) => p.kind),
  };
};

describe("sendPledge", () => {
  it("outside the vote the plain write saves, with no phases", async () => {
    const d = deps({ plain: vi.fn(() => Promise.resolve("saved" as const)) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({ kind: "saved" });
    expect(r.phases).toEqual([]);
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("an awaiting answer ends without asking the wallet", async () => {
    const d = deps({ plain: vi.fn(() => Promise.resolve("awaiting" as const)) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({ kind: "awaiting" });
    expect(d.prepare).not.toHaveBeenCalled();
    expect(d.sign).not.toHaveBeenCalled();
  });

  it("signs, relays, waits for the receipt itself, then settles as saved", async () => {
    const d = deps();
    const r = record();
    const onPid = vi.fn();
    expect(await sendPledge(d, r.set, onPid)).toEqual({ kind: "saved", hash: HASH });
    expect(r.phases).toEqual([
      { kind: "signing" },
      { kind: "relaying" },
      { kind: "waiting", hash: HASH },
      { kind: "saved", hash: HASH },
    ]);
    expect(onPid).toHaveBeenCalledWith("P1");
    expect(d.send).toHaveBeenCalledWith(PREP, SIG);
    expect(d.waitReceipt).toHaveBeenCalledWith(HASH);
    expect(d.settle).toHaveBeenCalledWith("P1", HASH);
  });

  it("saved at once when no transaction was needed", async () => {
    const d = deps({ send: vi.fn(() => Promise.resolve({ saved: true as const })) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({ kind: "saved" });
    expect(d.waitReceipt).not.toHaveBeenCalled();
  });

  it("a reverted receipt fails with the ballot's words and the hash, and drops the record", async () => {
    const d = deps({ waitReceipt: vi.fn(() => Promise.resolve("reverted" as const)) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "failed",
      reason: "The transaction failed on-chain.",
      hash: HASH,
    });
    // The server learns of it too, so the row stops showing "Recording on-chain…".
    expect(d.settle).toHaveBeenCalledWith("P1", HASH);
  });

  it("a receipt that takes too long fails with the hash, and doesn't settle", async () => {
    const d = deps({ waitReceipt: vi.fn(() => Promise.reject(new Error("timeout"))) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "failed",
      reason: "It's taking too long to be mined.",
      hash: HASH,
    });
    expect(d.settle).not.toHaveBeenCalled();
  });

  it("asks again while the server's node hasn't caught up with the receipt", async () => {
    const settle = vi.fn()
      .mockResolvedValueOnce("pending")
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce("saved");
    const d = deps({ settle });
    const r = record();
    expect((await sendPledge(d, r.set)).kind).toBe("saved");
    expect(settle).toHaveBeenCalledTimes(3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
  });

  it("mined but the API never caught up: recorded, the site shows it shortly", async () => {
    const d = deps({ settle: vi.fn(() => Promise.resolve("pending" as const)) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "recorded",
      reason: "It was recorded on Ethereum; the site will show it shortly.",
      hash: HASH,
    });
  });

  it("a refusal before the broadcast fails with the server's reason and no hash", async () => {
    const d = deps({
      send: vi.fn(() =>
        Promise.reject(new Error("The pledge wasn't recorded on-chain, so nothing was saved."))
      ),
    });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "failed",
      reason: "The pledge wasn't recorded on-chain, so nothing was saved.",
    });
    expect(d.waitReceipt).not.toHaveBeenCalled();
  });

  it("a declined signature sends nothing", async () => {
    const d = deps({ sign: vi.fn(() => Promise.reject(new Error("User rejected the request."))) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "failed",
      reason: "You didn't sign, so nothing was sent.",
    });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("a 409 pending at prepare waits for the earlier change and stops there", async () => {
    const d = deps({
      prepare: vi.fn(() => Promise.resolve({ pending: { hash: EARLIER, pid: "P1" } })),
    });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({ kind: "saved", hash: EARLIER, earlier: true });
    expect(d.waitReceipt).toHaveBeenCalledWith(EARLIER);
    expect(d.settle).toHaveBeenCalledWith("P1", EARLIER);
    expect(r.phases).toContainEqual({ kind: "waiting", hash: EARLIER, earlier: true });
    expect(d.sign).toHaveBeenCalledTimes(0);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("a 409 pending at the send waits for the earlier change and stops there", async () => {
    const d = deps({
      send: vi.fn(() => Promise.resolve({ pending: { hash: EARLIER, pid: "P1" } })),
    });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({ kind: "saved", hash: EARLIER, earlier: true });
    expect(d.sign).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.waitReceipt).toHaveBeenCalledTimes(1);
  });

  it("an earlier change that reverted is shown, not swallowed", async () => {
    const d = deps({
      prepare: vi.fn(() => Promise.resolve({ pending: { hash: EARLIER, pid: "P1" } })),
      waitReceipt: vi.fn(() => Promise.resolve("reverted" as const)),
    });
    const r = record();
    const end = await sendPledge(d, r.set);
    expect(end).toMatchObject({ kind: "failed", hash: EARLIER, earlier: true });
    expect((end as { reason: string }).reason).toMatch(/earlier change to this pledge failed/);
  });

  it("the earlier change still taking too long: says so, with its hash", async () => {
    const d = deps({
      prepare: vi.fn(() => Promise.resolve({ pending: { hash: EARLIER, pid: "P1" } })),
      waitReceipt: vi.fn(() => Promise.reject(new Error("timeout"))),
    });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "failed",
      reason:
        "An earlier change to this pledge is still being mined; the table shows it once it lands.",
      hash: EARLIER,
      earlier: true,
    });
    expect(d.sign).not.toHaveBeenCalled();
  });

  it("a 409 pending with no hash yet doesn't settle, and says another change is on its way", async () => {
    const d = deps({
      prepare: vi.fn(() => Promise.resolve({ pending: { hash: null, pid: "P1" } })),
    });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({
      kind: "failed",
      reason: "This pledge has another change on its way; the table shows it once it lands.",
      earlier: true,
    });
    expect(d.settle).not.toHaveBeenCalled();
  });

  it("a send with no hash (its outcome unclear) asks the server instead of a receipt", async () => {
    const d = deps({ send: vi.fn(() => Promise.resolve({ hash: null, pid: "P1" })) });
    const r = record();
    expect(await sendPledge(d, r.set)).toEqual({ kind: "saved" });
    expect(d.waitReceipt).not.toHaveBeenCalled();
    expect(d.settle).toHaveBeenCalledWith("P1", null);
  });
});
