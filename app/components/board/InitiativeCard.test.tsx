import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import InitiativeCard from "./InitiativeCard";
import type { Card } from "~/lib/api-types";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => null }));
vi.mock("~/components/ui/Money", () => ({ default: ({ value }: { value: number }) => value }));

const card = (over: Partial<Card>): Card => ({
  initiative: {
    id: "1",
    slug: "audit-tooling",
    title: "Audit tooling for rollups",
    summary: "s",
    goalUsd: 1000,
    status: "approved",
    type: "grant",
    sortRank: null,
    safeAddress: "",
    createdAt: 0,
    approvedAt: null,
  },
  summary: {
    pledged: 0,
    received: 0,
    donated: 0,
    total: 0,
    live: false,
    ledger: 0,
    paidOut: 0,
  },
  pct: 0,
  backers: 0,
  donations: 0,
  ledger: null,
  logos: [],
  funded: false,
  donationsEnabled: false,
  ...over,
});

const mount = (c: Card) =>
  render(
    <MemoryRouter>
      <InitiativeCard card={c} tokensOk={false} />
    </MemoryRouter>,
  );

it("counts donors as backers, but only pledgers go in the Pledged by strip", () => {
  mount(card({ backers: 3 }));
  expect(screen.getByText("· 3 backers")).toBeInTheDocument();
  expect(screen.queryByText("Pledged by")).not.toBeInTheDocument();
});

it("draws a silhouette for each pledger the board sends without a logo", () => {
  const { container } = mount(card({
    backers: 5,
    logos: [
      { company: "Acme", logoUrl: "", url: "" },
      { company: "Beta Org", logoUrl: "", url: "https://beta.example/" },
    ],
  }));
  expect(screen.getByText("Pledged by")).toBeInTheDocument();
  expect(screen.queryByText("Backed by")).not.toBeInTheDocument();
  expect(container.querySelectorAll("svg circle")).toHaveLength(2);
  expect(screen.getByTitle("Beta Org")).toBeInTheDocument();
});

it("shows a pledger's logo as a link to its site", () => {
  mount(card({
    backers: 1,
    logos: [{
      company: "Logo Co",
      logoUrl: "https://gw.example/ipfs/x",
      url: "https://logo.example/",
    }],
  }));
  expect(screen.getByRole("img", { name: "Logo Co" }).closest("a")).toHaveAttribute(
    "href",
    "https://logo.example/",
  );
});
