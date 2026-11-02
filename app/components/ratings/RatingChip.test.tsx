import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import RatingChip from "./RatingChip";

afterEach(cleanup);

const chip = (count: number, avg = 0, canRate = false) =>
  render(
    <RatingChip
      summary={{ avg, count, dist: [0, 0, 0, 0, 0], mine: null }}
      canRate={canRate}
      open={false}
      onToggle={() => {}}
      controls="form"
    />,
  ).container.textContent;

it("a dash until there is an average, then how many: - (0), - (2), 4.3 (3)", () => {
  expect(chip(0)).toBe("-(0)");
  cleanup();
  expect(chip(2, 4)).toBe("-(2)");
  cleanup();
  expect(chip(3, 4.3)).toBe("4.3(3)");
});

it("a badge holder sees Rate on an unrated initiative", () => {
  expect(chip(0, 0, true)).toBe("Rate");
});
