import { describe, expect, it } from "vitest";
import { ago } from "./format";
import { ledgerLine } from "~/components/initiative/DonationsTable";

const NOW = 1_800_000_000;

describe("ago", () => {
  it("rounds to the coarsest unit that reads naturally", () => {
    expect(ago(NOW - 5, NOW)).toBe("just now");
    expect(ago(NOW - 59, NOW)).toBe("just now");
    expect(ago(NOW - 60, NOW)).toBe("1 min ago");
    expect(ago(NOW - 4 * 60 - 30, NOW)).toBe("4 min ago");
    expect(ago(NOW - 3 * 3600, NOW)).toBe("3 h ago");
    expect(ago(NOW - 2 * 86400, NOW)).toMatch(/\d{4}$/); // a date past a day
    expect(ago(NOW + 100, NOW)).toBe("just now"); // clock skew never reads as the future
  });
});

describe("ledgerLine", () => {
  it("says when the ledger was checked and how long a transfer can take", () => {
    expect(ledgerLine(null)).toBe("");
    expect(ledgerLine({ checkedAt: null, ok: true, intervalMinutes: 10 })).toBe(
      "Not checked yet. New transfers appear here within about 10 minutes.",
    );
    const recent = Date.now() / 1000 - 30;
    expect(ledgerLine({ checkedAt: recent, ok: true, intervalMinutes: 10 })).toBe(
      "Checked just now. New transfers appear here within about 10 minutes.",
    );
    expect(ledgerLine({ checkedAt: recent, ok: false, intervalMinutes: null })).toBe(
      "Last check just now failed; retrying.",
    );
  });
});
