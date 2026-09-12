import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Footer from "./Footer";

test("the footer links to the donation terms on every page", () => {
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Donation Terms" })).toHaveAttribute(
    "href",
    "/donation-terms",
  );
});

test("no transparency link anywhere in the footer (Griff, 2026-09-12)", () => {
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link", { name: /transparency/i })).toBeNull();
  expect(document.body.textContent).not.toMatch(/transparency/i);
});
