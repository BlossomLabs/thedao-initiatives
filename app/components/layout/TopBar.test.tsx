import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TopBar from "./TopBar";

const mount = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar staticShell />
    </MemoryRouter>,
  );

describe("TopBar hamburger", () => {
  it("opens a menu with the site links and closes it on Escape", () => {
    mount();
    expect(screen.queryByRole("navigation", { name: "Site" })).toBeInTheDocument(); // desktop nav
    expect(document.getElementById("site-menu")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(toggle);
    const menu = document.getElementById("site-menu")!;
    expect(menu).toBeInTheDocument();
    expect(menu.querySelectorAll("a")).toHaveLength(2);
    expect(menu.textContent).toContain("Suggest an initiative");
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.getElementById("site-menu")).toBeNull();
  });

  it("closes when a link inside it is followed", () => {
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const submit = document.getElementById("site-menu")!.querySelector('a[href="/submit"]')!;
    fireEvent.click(submit);
    expect(document.getElementById("site-menu")).toBeNull();
  });

  it("closes on a click outside", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.mouseDown(document.body);
    expect(document.getElementById("site-menu")).toBeNull();
  });
});
