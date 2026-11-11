import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ShareSpent from "./ShareSpent";

afterEach(cleanup);

it("the ring around the avatar is what is left of the share; one line per settled tier", () => {
  render(
    <ShareSpent
      avatar={<img alt="" />}
      share={2_000}
      settled={[{ tier: "S", funded: 2, paid: 1_250 }]}
    />,
  );
  expect(screen.getByText("Your share")).toBeInTheDocument();
  expect(screen.getByText("$750 left of $2,000")).toBeInTheDocument();
  expect(screen.getByText("Tier-S paid $1,250 to 2 initiatives")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "Your share left" })).toHaveAttribute(
    "aria-valuenow",
    "750",
  );
});

it("a settled tier that took nothing from this badge says so", () => {
  render(
    <ShareSpent
      avatar={<img alt="" />}
      share={2_000}
      settled={[{ tier: "S", funded: 1, paid: 0 }, { tier: "A", funded: 0, paid: 0 }]}
    />,
  );
  expect(screen.getByText("Tier-S paid nothing from your share")).toBeInTheDocument();
  expect(screen.getByText("Tier-A funded nothing")).toBeInTheDocument();
  expect(screen.getByText("$2,000 left of $2,000")).toBeInTheDocument();
});
