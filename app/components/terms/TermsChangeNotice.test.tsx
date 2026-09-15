import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TermsChangeNotice from "./TermsChangeNotice";
import type { TermsVersion } from "~/data/terms";

const material: TermsVersion = {
  effectiveDate: "2026-09-06",
  id: "a".repeat(64),
  material: true,
  body: "# T",
};
const day = (n: number) => new Date(Date.UTC(2026, 8, 6 + n, 12));
const mount = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

test("shows for 30 days from the effective date of a material version", () => {
  mount(<TermsChangeNotice terms={material} now={day(10)} />);
  const box = screen.getByRole("status");
  expect(box).toHaveTextContent("Notice of material change");
  expect(box).toHaveTextContent("September 6, 2026");
});

test("hidden when the version is not material or the window has passed", () => {
  mount(<TermsChangeNotice terms={{ ...material, material: false }} now={day(10)} />);
  expect(screen.queryByRole("status")).toBeNull();
  mount(<TermsChangeNotice terms={material} now={day(31)} />);
  expect(screen.queryByRole("status")).toBeNull();
  mount(<TermsChangeNotice terms={material} now={day(-1)} />);
  expect(screen.queryByRole("status")).toBeNull();
});

test("compact variant is one line with a link to the terms", () => {
  mount(<TermsChangeNotice terms={material} now={day(0)} compact />);
  expect(screen.getByRole("status")).toHaveTextContent("changed on September 6, 2026");
  expect(screen.getByRole("link", { name: "Review the changes" })).toHaveAttribute(
    "href",
    "/donation-terms",
  );
});
