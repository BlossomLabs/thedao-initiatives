import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { RoundView } from "~/hooks/use-vote";
import { NO_ROUND } from "../../../shared/vote/manifest";
import ValuationNotes from "./ValuationNotes";

afterEach(cleanup);
const round = { ...NO_ROUND, slugs: ["example"] };
const view: RoundView = {
  poolInitialized: true,
  registrationClosesAt: 0,
  closed: true,
  accepted: {},
  rejected: [],
  tiers: [{
    tier: "S",
    status: "settled",
    at: 100,
    forced: false,
    confirmed: false,
    funded: ["example"],
    awards: { example: "60000000" },
  }],
  live: { funded: [], awards: {} },
};

it("shows fallback and failed balance evidence separately from current funding gaps", () => {
  render(
    <ValuationNotes
      round={round}
      view={{
        ...view,
        valuation: { available: true, issues: [{ project: 0, currency: 1, flags: 3 }] },
        settlementCoverage: {
          example: {
            awardUsd: "60000000",
            askUsd: "80000000",
            shortfallUsd: "20000000",
            excessAwardUsd: "0",
          },
        },
      }}
    />,
  );
  expect(screen.getByText(/S-Tier settled, awaiting chain finality/)).toBeInTheDocument();
  expect(screen.getByText(/last stored good price/)).toBeInTheDocument();
  expect(screen.getByText(/balance could not be read and counts as zero/)).toBeInTheDocument();
  expect(screen.getByText(/Current gap: \$20/)).toBeInTheDocument();
});

it("a valid zero balance produces no failed-balance warning", () => {
  render(
    <ValuationNotes
      round={round}
      view={{ ...view, closed: false, valuation: { available: true, issues: [] } }}
    />,
  );
  expect(screen.queryByText(/balance could not be read/)).toBeNull();
  expect(screen.queryByText("Funding details")).toBeNull();
});
