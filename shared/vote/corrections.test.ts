import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { SIGNED_BALLOTS_ABI } from "./abi";
import { type CorrectionView, prepareCorrection } from "./corrections";

const ZERO = "0x0000000000000000000000000000000000000000";
const ACCOUNT = "0x1000000000000000000000000000000000000001";
export const correctionView: CorrectionView = {
  supported: true,
  now: 1100,
  final: false,
  settled: [],
  poolUsd: "100000000",
  pendingPoolUsd: null,
  poolUpdateNonce: "0",
  manifest: {
    kind: "test",
    chainId: 11155111,
    contract: "0x2000000000000000000000000000000000000002",
    deployBlock: 1,
    configRevision: "7",
    opensAt: 1000,
    closesAt: 4100,
    schedule: {
      opensAt: 1000,
      firstTallyAt: [2000, 3000, 4000],
      initialWindow: 100,
      maxWindows: 1,
    },
    poolUsd: "100000000",
    slugs: ["alpha"],
    accounts: [ACCOUNT],
    projects: [{ goalUsd: "10000000", rfp: false, groups: [] }],
    groups: ["Old name"],
    independentTiers: 1,
    currencies: [{ symbol: "USD", asset: ZERO, usdFeed: ZERO }, {
      symbol: "Token",
      asset: ACCOUNT,
      usdFeed: ZERO,
    }],
  },
};
const edit = {
  action: "initiative",
  revision: "7",
  id: "0",
  account: ACCOUNT,
  goalUsd: "12.345678",
  rfp: false,
  groups: [0],
};
const decoded = (body: Record<string, unknown>, v = correctionView) =>
  prepareCorrection(body, v).batch.transactions.map((t) =>
    decodeFunctionData({ abi: SIGNED_BALLOTS_ABI, data: t.data })
  );

describe("correction batches", () => {
  it("guards the reviewed configuration and encodes exact dollars, the same ID and affiliation bits", () => {
    const calls = decoded(edit);
    expect(calls[0]).toMatchObject({ functionName: "requireConfigRevision", args: [7n] });
    expect(calls[1]).toMatchObject({
      functionName: "setInitiative",
      args: [0n, ACCOUNT, 12345678n, false, 1n],
    });
  });
  it("refuses stale settings, settled initiatives, quiet endings, invalid amounts and RFP affiliations", () => {
    for (
      const body of [{ ...edit, revision: "6" }, { ...edit, goalUsd: "1e6" }, {
        ...edit,
        goalUsd: "1.0000001",
      }, { ...edit, rfp: true }]
    ) {
      expect(() => prepareCorrection(body, correctionView)).toThrow();
    }
    expect(() => prepareCorrection(edit, { ...correctionView, settled: [0] })).toThrow(
      "already settled",
    );
    expect(() => prepareCorrection(edit, { ...correctionView, now: 2000 })).toThrow("quiet ending");
    expect(decoded(edit, { ...correctionView, now: 2100 })[1].functionName).toBe("setInitiative");
  });
  it("requires proposals for late pool increases and refuses stale activation nonces", () => {
    const v = { ...correctionView, now: 2200 };
    expect(decoded({ action: "pool", revision: "7", amountUsd: "120" }, v)[1].functionName).toBe(
      "proposePoolUsd",
    );
    expect(() => prepareCorrection({ action: "pool", revision: "7", amountUsd: "99" }, v)).toThrow(
      "cannot decrease",
    );
    const pending = { ...v, pendingPoolUsd: "120000000", poolUpdateNonce: "3" };
    expect(() => prepareCorrection({ action: "activatePool", revision: "7", nonce: "2" }, pending))
      .toThrow("changed");
    expect(decoded({ action: "activatePool", revision: "7", nonce: "3" }, pending)[1])
      .toMatchObject({ functionName: "activatePoolUpdate", args: [3n] });
  });
  it("keeps group renames available after closing while refusing currency changes after opening", () => {
    expect(
      decoded({ action: "group", revision: "7", id: "0", name: "Corrected" }, {
        ...correctionView,
        now: 5000,
        final: true,
      })[1].functionName,
    ).toBe("setGroupName");
    expect(() =>
      prepareCorrection({
        action: "currency",
        revision: "7",
        id: "1",
        usdFeed: ZERO,
        disabled: true,
      }, correctionView)
    ).toThrow("froze");
  });
  it("validates complete schedules and only permits future date changes after opening", () => {
    const body = {
      action: "schedule",
      revision: "7",
      opensAt: "1000",
      firstTallyAt: [2000, 3100, 4200],
      initialWindow: "100",
      maxWindows: "1",
    };
    expect(decoded(body, { ...correctionView, now: 900 })[1].functionName).toBe("setSchedule");
    expect(decoded(body)[1].functionName).toBe("setDates");
    expect(() => prepareCorrection({ ...body, initialWindow: "50" }, correctionView)).toThrow(
      "frozen",
    );
    expect(() => prepareCorrection({ ...body, firstTallyAt: [2000, 2050, 4000] }, correctionView))
      .toThrow("overlap");
  });
});
