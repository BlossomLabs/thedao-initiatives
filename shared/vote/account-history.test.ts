import { expect, it } from "vitest";
import { accountPeriods } from "./account-history";

it("uses the old wallet before correction, including when the latest wallet changes back", () => {
  const changes = [
    { block: 1, logIndex: 0, id: 0, account: "0x01" as const },
    { block: 10, logIndex: 0, id: 0, account: "0x02" as const },
    { block: 20, logIndex: 0, id: 0, account: "0x01" as const },
  ];
  expect(accountPeriods(changes, 5, 25)).toEqual([
    { from: 5, to: 9, accounts: ["0x01"] },
    { from: 10, to: 19, accounts: ["0x02"] },
    { from: 20, to: 25, accounts: ["0x01"] },
  ]);
});

it("takes the final configuration in a block and ignores edits that do not change accounts", () => {
  expect(accountPeriods(
    [
      { block: 10, logIndex: 1, id: 0, account: "0x03" },
      { block: 1, logIndex: 0, id: 0, account: "0x01" },
      { block: 10, logIndex: 0, id: 0, account: "0x02" },
      { block: 11, logIndex: 0, id: 0, account: "0x03" },
      { block: 15, logIndex: 0, id: 1, account: "0x04" },
    ],
    10,
    16,
  )).toEqual([
    { from: 10, to: 14, accounts: ["0x03"] },
    { from: 15, to: 16, accounts: ["0x03", "0x04"] },
  ]);
});
