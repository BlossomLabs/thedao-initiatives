import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import SafeSyncIcon, { OUTDATED_SECS, safeSyncState } from "./SafeSyncIcon";
import type { SafeSyncState } from "~/lib/api-types";

const NOW = 2_000_000_000;
const sync = (over: Partial<SafeSyncState>): SafeSyncState => ({
  at: NOW - 60,
  lastTxHash: "",
  ok: true,
  error: "",
  backfilled: true,
  resumeUrl: "",
  ...over,
});

it("maps every sync state to one kind", () => {
  expect(safeSyncState("", null, NOW).kind).toBe("none");
  expect(safeSyncState("0xsafe", null, NOW).kind).toBe("never");
  expect(safeSyncState("0xsafe", sync({}), NOW).kind).toBe("ok");
  expect(safeSyncState("0xsafe", sync({ at: NOW - OUTDATED_SECS - 1 }), NOW).kind).toBe("outdated");
  expect(safeSyncState("0xsafe", sync({ backfilled: false }), NOW).kind).toBe("syncing");
  expect(safeSyncState("0xsafe", sync({ updating: true }), NOW).kind).toBe("syncing");
  expect(safeSyncState("0xsafe", sync({ ok: false, error: "rate limited" }), NOW).kind)
    .toBe("error");
});

it("an error wins over outdated, and its message is in the label", () => {
  const s = safeSyncState("0xsafe", sync({ ok: false, error: "rate limited", at: 1 }), NOW);
  expect(s.kind).toBe("error");
  expect(s.label).toBe("Sync error: rate limited");
});

it("labels say what happened and when", () => {
  expect(safeSyncState("0xsafe", sync({}), NOW).label).toMatch(/^Synced /);
  expect(safeSyncState("0xsafe", sync({ at: NOW - 3 * 86400 }), NOW).label)
    .toMatch(/^Outdated: last synced /);
  expect(safeSyncState("0xsafe", null, NOW).label).toBe("Never synced");
  expect(safeSyncState("", null, NOW).label).toBe("No Safe");
});

it("renders one labelled icon, the label also as its tooltip", () => {
  render(<SafeSyncIcon safeAddress="0xsafe" sync={sync({ ok: false, error: "boom" })} now={NOW} />);
  const icon = screen.getByRole("img", { name: "Sync error: boom" });
  expect(icon).toHaveAttribute("title", "Sync error: boom");
});
