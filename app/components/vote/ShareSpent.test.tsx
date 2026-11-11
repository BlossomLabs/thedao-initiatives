import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ShareSpent from "./ShareSpent";

afterEach(cleanup);

it("says what the badge paid in each settled tier and what is left for the open ones", () => {
  render(
    <ShareSpent
      share={2_000}
      settled={[{
        tier: "S",
        funded: ["Alpha fuzzing", "Beta audits"],
        paid: [{ title: "Alpha fuzzing", usd: 900 }, { title: "Beta audits", usd: 350 }],
      }]}
      open={["A", "B"]}
    />,
  );
  expect(screen.getByText(/Your share: \$2,000/)).toBeInTheDocument();
  expect(screen.getByText(/S settled, funding Alpha fuzzing and Beta audits\./))
    .toBeInTheDocument();
  expect(screen.getByText(/Your share paid \$1,250/)).toBeInTheDocument();
  expect(screen.getByText(/Alpha fuzzing \$900/)).toBeInTheDocument();
  expect(screen.getByText(/Beta audits \$350/)).toBeInTheDocument();
  expect(screen.getByText(/Remaining share: \$750, for A and B/)).toBeInTheDocument();
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1250");
});

it("a settled tier that took nothing from this badge says so", () => {
  render(
    <ShareSpent
      share={2_000}
      settled={[{ tier: "S", funded: ["Gamma"], paid: [] }, { tier: "A", funded: [], paid: [] }]}
      open={["B"]}
    />,
  );
  expect(screen.getByText(/S settled, funding Gamma\. None of your share went to it\./))
    .toBeInTheDocument();
  expect(screen.getByText(/A settled, funding nothing\./)).toBeInTheDocument();
  expect(screen.getByText(/Remaining share: \$2,000, for B/)).toBeInTheDocument();
});
