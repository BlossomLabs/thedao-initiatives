import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TermsDocument from "./TermsDocument";
import type { TermsVersion } from "~/data/terms";

const v = (date: string, ch: string, material = false): TermsVersion => ({
  effectiveDate: date,
  id: ch.repeat(64),
  material,
  body: `# Terms of ${date}\n\nBody.`,
});
const versions = [v("2027-03-01", "c", true), v("2026-11-15", "b"), v("2026-09-06", "a")];
const mount = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

test("current version: effective date, short id, text, and links to every earlier version", () => {
  mount(<TermsDocument terms={versions[0]} versions={versions} current />);
  expect(screen.getByText("Effective March 1, 2027")).toBeInTheDocument();
  expect(screen.getByText("cccccccc")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Terms of 2027-03-01" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Effective November 15, 2026" })).toHaveAttribute(
    "href",
    "/donation-terms/v/" + "b".repeat(64),
  );
  expect(screen.getByRole("link", { name: "Effective September 6, 2026" })).toHaveAttribute(
    "href",
    "/donation-terms/v/" + "a".repeat(64),
  );
  expect(screen.queryByText(/read the current terms/)).toBeNull();
});

test("the oldest version has no earlier versions", () => {
  mount(<TermsDocument terms={versions[2]} versions={versions} current={false} />);
  expect(screen.getByText(/No earlier versions/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^Effective/ })).toBeNull();
});

test("an earlier version says so, links back, and never shows the change notice", () => {
  mount(<TermsDocument terms={versions[1]} versions={versions} current={false} />);
  expect(screen.getByText("Was effective November 15, 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "read the current terms" })).toHaveAttribute(
    "href",
    "/donation-terms",
  );
  expect(screen.queryByRole("status")).toBeNull();
});
