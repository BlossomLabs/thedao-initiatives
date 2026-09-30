import { MemoryRouter } from "react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Sponsors from "./Sponsors";
import type { Sponsor } from "~/lib/api-types";

const sponsor = (company: string, slugs: string[]): Sponsor => ({
  company,
  logoUrl: "",
  url: "",
  totalUsd: 1000 * slugs.length,
  initiatives: slugs.map((slug) => ({ slug, title: `Title ${slug}`, amountUsd: 1000 })),
});

const view = (sponsors?: Sponsor[]) =>
  render(
    <MemoryRouter>
      <Sponsors sponsors={sponsors} />
    </MemoryRouter>,
  );

it("renders nothing until someone has pledged", () => {
  const { container } = view([]);
  expect(container.innerHTML).toBe("");
  expect(view(undefined).container.innerHTML).toBe("");
});

it("lists each sponsor with its total and links its one initiative", () => {
  view([sponsor("Ethereum Foundation", ["vyper"])]);
  expect(screen.getByText("Top sponsors of security for Ethereum")).toBeTruthy();
  expect(screen.getByText("Ethereum Foundation")).toBeTruthy();
  expect(screen.getByText("$1,000")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Title vyper" }).getAttribute("href")).toBe(
    "/initiative/vyper",
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows the first initiative and expands to all of them", () => {
  view([sponsor("Acme", ["a", "b", "c"])]);
  expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Title a"]);
  const more = screen.getByRole("button", { name: "+2 more" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
    "Title a",
    "Title b",
    "Title c",
  ]);
  expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
    "true",
  );
});
