import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import CardTitle from "./CardTitle";

const view = (title: string, categories: string[]) =>
  render(
    <MemoryRouter>
      <CardTitle title={title} href="/initiative/x" categories={categories} />
    </MemoryRouter>,
  );

describe("CardTitle while the popover code loads", () => {
  it("a focused stand-in hands focus to the real dot button", async () => {
    view("Audit tooling", ["opsec"]);
    const standIn = screen.getByRole("button", { name: "Categories: OpSec" });
    expect(standIn).not.toHaveAttribute("data-ready");
    standIn.focus();
    // the lazy chunk can take a while under a full, parallel test run
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-ready"), {
      timeout: 5000,
    });
    expect(document.activeElement).toHaveAccessibleName("Categories: OpSec");
  });
});

describe("CardTitle", () => {
  it("has one keyboard title link named with the full title", () => {
    view("Audit tooling for rollups", ["opsec"]);
    const links = screen.getAllByRole("link", { name: "Audit tooling for rollups" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/initiative/x");
    expect(links[0]).not.toHaveAttribute("tabindex", "-1");
  });

  it("draws no category icon for an untagged card", () => {
    view("Audit tooling", []);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("puts the primary category's icon before the title, as one button naming them all", () => {
    view("T", ["defi", "opsec", "compilers", "sigma"]);
    const btn = screen.getByRole("button", {
      name: "Categories: DeFi Safety, OpSec, Compilers & Languages",
    });
    const icons = btn.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute("data-category")).toBe("defi");
    const link = screen.getByRole("link", { name: "T" });
    // the button comes first, then the title
    expect(btn.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a click opens a popover with Browse category links, and Escape returns focus", async () => {
    view("Audit tooling", ["opsec", "defi"]);
    // the popover code loads after the first render; a stand-in shows until then
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Categories:/ })).toHaveAttribute("data-ready")
    );
    const btn = screen.getByRole("button", { name: /Categories:/ });
    btn.focus();
    fireEvent.click(btn);
    const browse = await screen.findByRole("link", { name: "Browse category: OpSec" });
    expect(browse).toHaveAttribute("href", "/?cat=opsec");
    // the whole row is the link, marked with a chevron rather than words
    expect(browse).toHaveTextContent("OpSec");
    expect(screen.queryByText("Browse category")).toBeNull();
    expect(screen.getByRole("link", { name: "Browse category: DeFi Safety" }))
      .toHaveAttribute("href", "/?cat=defi");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("link", { name: /Browse category/ })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });
});
