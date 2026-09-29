import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import CategoryDot from "./CategoryDot";

it("draws the colour inside a dark ring and a white ring, so light and dark dots read the same size", () => {
  const { container } = render(<CategoryDot slug="defi" />);
  const dot = container.firstElementChild as HTMLElement;
  expect(dot.style.background).toBeTruthy();
  expect(dot.className).toMatch(/inset_0_0_0_1px_rgba\(0,0,0,/);
  expect(dot.className).toMatch(/,0_0_0_1px_rgba\(255,255,255,/);
  expect(dot.className).toContain("size-2");
});
