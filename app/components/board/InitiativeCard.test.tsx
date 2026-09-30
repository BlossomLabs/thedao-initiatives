import { MemoryRouter } from "react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import InitiativeCard, { DonateStandIn } from "./InitiativeCard";
import type { Card } from "~/lib/api-types";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => <p>donate widget</p> }));
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
    categories: [],
    recipientTeam: "",
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

it("shows dots, not category pills, on a tagged card", () => {
  const base = card({});
  mount(card({ initiative: { ...base.initiative, categories: ["opsec"] } }));
  expect(screen.getByRole("button", { name: "Categories: OpSec" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /OpSec/ })).toBeNull();
});

it("labels a featured card as Featured", () => {
  render(
    <MemoryRouter>
      <InitiativeCard card={card({})} tokensOk={false} featured />
    </MemoryRouter>,
  );
  expect(screen.getByText("Featured")).toBeInTheDocument();
});

it("no Featured label from a rank alone: the board decides what is featured", () => {
  const base = card({});
  mount(card({ initiative: { ...base.initiative, sortRank: 4 } }));
  expect(screen.queryByText("Featured")).toBeNull();
});

it("fetches the Donate panel only when asked, showing a look-alike until it is in", async () => {
  render(
    <MemoryRouter>
      <InitiativeCard card={card({ donationsEnabled: true })} tokensOk />
    </MemoryRouter>,
  );
  expect(screen.queryByText("donate widget")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Donate" }));
  // The toggle now reads Close; the panel's own Donate button is the stand-in's, disabled.
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Donate" })).toBeDisabled();
  expect(await screen.findByText("donate widget")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Donate" })).toBeNull();
});

it("the Donate look-alike links the terms and is not marked busy", () => {
  // Rendered on its own: once a test has loaded the panel's chunk, React no
  // longer shows the stand-in for the lazy part.
  render(
    <MemoryRouter>
      <DonateStandIn />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Donation Terms" })).toHaveAttribute(
    "href",
    "/donation-terms",
  );
  expect(screen.getByRole("button", { name: "Wallet" })).toBeDisabled();
  expect(document.querySelector("[aria-busy]")).toBeNull();
});

it("marks an initiative approved in the last 7 days as New, and not older ones", () => {
  const now = Date.now() / 1000;
  const base = card({}).initiative;
  const { unmount } = mount(card({ initiative: { ...base, approvedAt: now - 2 * 86400 } }));
  expect(screen.getByText("New")).toBeInTheDocument();
  unmount();
  mount(card({ initiative: { ...base, approvedAt: now - 8 * 86400 } }));
  expect(screen.queryByText("New")).toBeNull();
});

it("the watchlist bookmark is a pressed-state button named for the initiative", () => {
  const toggle = vi.fn();
  render(
    <MemoryRouter>
      <InitiativeCard card={card({})} tokensOk={false} watch={{ on: true, toggle }} />
    </MemoryRouter>,
  );
  const bookmark = screen.getByRole("button", {
    name: "Remove Audit tooling for rollups from watchlist",
  });
  expect(bookmark).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(bookmark);
  expect(toggle).toHaveBeenCalled();
});

it("a featured card shows Featured, not New", () => {
  const base = card({}).initiative;
  render(
    <MemoryRouter>
      <InitiativeCard
        card={card({ initiative: { ...base, approvedAt: Date.now() / 1000 - 86400 } })}
        tokensOk={false}
        featured
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("Featured")).toBeInTheDocument();
  expect(screen.queryByText("New")).toBeNull();
});

it("shows one label on the top edge: AI pick over Featured over New", () => {
  const base = card({}).initiative;
  const fresh = card({ initiative: { ...base, approvedAt: Date.now() / 1000 - 86400 } });
  const labels = () => ["AI pick", "Featured", "New"].filter((t) => screen.queryByText(t));
  const view = (props: { aiTop?: boolean; featured?: boolean }) =>
    render(
      <MemoryRouter>
        <InitiativeCard card={fresh} tokensOk={false} {...props} />
      </MemoryRouter>,
    );
  let v = view({ aiTop: true, featured: true });
  expect(labels()).toEqual(["AI pick"]);
  v.unmount();
  v = view({ featured: true });
  expect(labels()).toEqual(["Featured"]);
  v.unmount();
  view({});
  expect(labels()).toEqual(["New"]);
});
