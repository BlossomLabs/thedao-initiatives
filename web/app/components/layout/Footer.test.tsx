import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Footer from "./Footer";

describe("Footer", () => {
  it("links to the donation terms on every page", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "Donation Terms" })).toHaveAttribute(
      "href",
      "/donation-terms",
    );
    expect(screen.getByRole("link", { name: "Transparency" })).toBeInTheDocument();
  });
});
