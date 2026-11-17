import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import Footer, { copyrightYears } from "./Footer";

const open = vi.hoisted(() => vi.fn());
vi.mock("~/lib/support", () => ({ openPledgeRequest: open }));

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

test("sends backers to the pledge form, not to an email address", () => {
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/@/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "pledge form" }));
  expect(open).toHaveBeenCalledWith();
});

test("the copyright starts in 2026, when TheDAO LLC was founded", () => {
  expect(copyrightYears(new Date(2026, 10, 18))).toBe("2026");
  expect(copyrightYears(new Date(2027, 0, 1))).toBe("2026–2027");
});
