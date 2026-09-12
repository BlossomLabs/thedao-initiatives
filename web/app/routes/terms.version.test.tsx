import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import TermsVersionPage from "./terms.version";
import { formatEffectiveDate, TERMS } from "~/data/terms";

const at = (id: string) =>
  render(
    <MemoryRouter initialEntries={["/donation-terms/v/" + id]}>
      <Routes>
        <Route path="/donation-terms/v/:id" element={<TermsVersionPage />} />
      </Routes>
    </MemoryRouter>,
  );

test("a known id renders that version", () => {
  at(TERMS.id);
  expect(screen.getByText("Effective " + formatEffectiveDate(TERMS.effectiveDate)))
    .toBeInTheDocument();
});

test("an unknown or malformed id is a soft 404 with a way back", () => {
  at("f".repeat(64));
  expect(screen.getByRole("heading", { name: "No such version" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /current donation terms/ })).toHaveAttribute(
    "href",
    "/donation-terms",
  );
  at("deadbeef");
  expect(screen.getAllByRole("heading", { name: "No such version" })).toHaveLength(2);
});
