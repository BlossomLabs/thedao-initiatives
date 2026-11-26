import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AdminInitiative } from "~/lib/api-types";
import SettingsForm from "./SettingsForm";

vi.mock("~/hooks/use-admin-api", () => ({ useAdminApi: () => vi.fn() }));

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
