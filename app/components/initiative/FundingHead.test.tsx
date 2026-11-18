import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import FundingHead from "./FundingHead";

const summary = {
  pledged: 60_000,
  received: 0,
  donated: 0,
  total: 60_000,
  live: false,
  ledger: 0,
  paidOut: 0,
};
const now = Math.floor(Date.now() / 1000);
const mount = (qualifyBy: number | null, onBallot = false) =>
  render(
    <FundingHead
      summary={summary}
      goal={240_000}
      pct={25}
      funded={false}
      vote={{ show: true, floorPct: 25, capUsd: 200_000, qualifyBy }}
      onBallot={onBallot}
    />,
  );

it("before the deadline to qualify, it says it qualifies and how", () => {
  mount(now + 3600);
  expect(screen.getByText("Qualified for the vote")).toBeInTheDocument();
  expect(screen.getByText(/qualifies for TheDAO's vote at 25%/)).toBeInTheDocument();
});

it("after it, one not on the ballot is just Open for funding", () => {
  mount(now - 60);
  expect(screen.queryByText("Qualified for the vote")).toBeNull();
  expect(screen.queryByText(/qualif/i)).toBeNull();
});

it("after it, one on the ballot still says so", () => {
  mount(now - 60, true);
  expect(screen.getByText("On the ballot")).toBeInTheDocument();
});
