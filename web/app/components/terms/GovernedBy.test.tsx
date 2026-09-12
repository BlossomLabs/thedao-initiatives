import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import GovernedBy from "./GovernedBy";

const mount = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

test("governed-by line links to the donation terms", () => {
  mount(<GovernedBy />);
  const p = screen.getByText(/Transfers to this address are governed by the/);
  expect(p.tagName).toBe("P");
  expect(screen.getByRole("link", { name: "Donation Terms" })).toHaveAttribute(
    "href",
    "/donation-terms",
  );
});

test("inline variant is a span for use inside a sentence", () => {
  mount(<GovernedBy inline />);
  expect(screen.getByText(/governed by the/).tagName).toBe("SPAN");
});
