import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Sponsors from "./Sponsors";
import type { Sponsor } from "~/lib/api-types";

const sponsor = (company: string, totalUsd: number, url = ""): Sponsor => ({
  company,
  logoUrl: "",
  url,
  totalUsd,
});

it("renders nothing until someone has pledged", () => {
  expect(render(<Sponsors sponsors={[]} />).container.innerHTML).toBe("");
  expect(render(<Sponsors sponsors={undefined} />).container.innerHTML).toBe("");
});

it("holds the place with a skeleton while the board loads", () => {
  const { container } = render(<Sponsors loading />);
  expect(screen.getByText("Top sponsors of security for Ethereum")).toBeTruthy();
  expect(container.querySelector("[aria-busy]")?.childElementCount).toBe(1);
  expect(screen.queryByRole("list")).toBeNull();
});

it("lists the sponsors in order in one row with whole-dollar totals", () => {
  render(
    <Sponsors
      sponsors={[
        sponsor("Argot Collective", 151000.4, "https://argot.org"),
        sponsor("Acme", 800.5),
      ]}
    />,
  );
  expect(screen.getByText("Top sponsors of security for Ethereum")).toBeTruthy();
  const items = screen.getAllByRole("listitem");
  expect(items.map((li) => li.textContent)).toEqual([
    "Argot Collective$151,000 pledged",
    "Acme$801 pledged",
  ]);
  expect(items[0].parentElement).toBe(screen.getByRole("list"));
  expect(screen.getByRole("link", { name: "Argot Collective" }).getAttribute("href")).toBe(
    "https://argot.org",
  );
});
