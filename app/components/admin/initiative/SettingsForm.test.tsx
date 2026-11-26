import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AdminInitiative } from "~/lib/api-types";
import SettingsForm from "./SettingsForm";

const adminApi = vi.hoisted(() => vi.fn());
vi.mock("~/hooks/use-admin-api", () => ({ useAdminApi: () => adminApi }));

const grant = {
  id: "rfp23",
  slug: "valos",
  type: "grant",
  proposer: "",
  sortRank: null,
  paidOutUsd: 0,
  affiliations: ["SEAL"],
} as unknown as AdminInitiative;

it("on the ballot the affiliations are set on the round (#149)", () => {
  render(<SettingsForm r={grant} run={vi.fn()} onBallot />);
  expect(document.getElementById("s-affiliations")).toBeDisabled();
  expect(screen.getByText("On the ballot: a round admin changes this on the round."))
    .toBeInTheDocument();
});

it("off the ballot the affiliations can change", () => {
  render(<SettingsForm r={grant} run={vi.fn()} />);
  expect(document.getElementById("s-affiliations")).not.toBeDisabled();
});

it("an affiliations draft from before the ballot is never sent with another setting", async () => {
  const run = vi.fn((fn: () => Promise<unknown>) => fn());
  const { rerender } = render(<SettingsForm r={grant} run={run as never} />);
  fireEvent.change(document.getElementById("s-affiliations")!, { target: { value: "SEAL, Foo" } });
  rerender(<SettingsForm r={grant} run={run as never} onBallot />);
  fireEvent.change(document.getElementById("s-paid")!, { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(adminApi).toHaveBeenCalledWith("/api/admin/initiatives/rfp23", {
    method: "PATCH",
    json: { paidOutUsd: "500" },
  });
});
