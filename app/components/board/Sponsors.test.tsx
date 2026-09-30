import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Sponsors from "./Sponsors";
import type { Sponsor } from "~/lib/api-types";

const sponsor = (company: string, totalUsd: number, url = ""): Sponsor => ({
  company,
  logoUrl: "",
  url,
  totalUsd,
  initiatives: [{ slug: "x", title: "X", amountUsd: totalUsd }],
});

it("renders nothing until someone has pledged", () => {
  expect(render(<Sponsors sponsors={[]} />).container.innerHTML).toBe("");
  expect(render(<Sponsors sponsors={undefined} />).container.innerHTML).toBe("");
});

it("numbers the sponsors in order with whole-dollar totals, the leader inverted", () => {
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
    "Argot Collective$151,000 pledged#01",
    "Acme$801 pledged#02",
  ]);
  expect(items[0].className).toContain("bg-white ");
  expect(items[1].className).not.toContain("bg-white ");
  expect(screen.getByRole("link", { name: "Argot Collective" }).getAttribute("href")).toBe(
    "https://argot.org",
  );
});
