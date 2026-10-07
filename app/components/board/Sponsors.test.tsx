import { render, screen, within } from "@testing-library/react";
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
  // as tall as the panel this device last drew, else as three sponsors take
  expect(container.querySelector("[aria-busy] > *")?.className).toContain(
    "h-[var(--sponsors-h,268px)]",
  );
  expect(screen.queryByRole("list")).toBeNull();
});

it('six to eight: "pledged by" only where the amount sits over the logo and name', () => {
  render(<Sponsors sponsors={["A", "B", "C", "D", "E", "F"].map((c) => sponsor(c, 5000))} />);
  const first = screen.getAllByRole("listitem")[0];
  // side by side under the full width, the amount follows the name: "$5,000 pledged"
  expect(within(first).getByText("pledged")).toHaveClass("min-[1100px]:hidden");
  expect(within(first).getByText("pledged by")).toHaveClass("hidden", "min-[1100px]:block");
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
