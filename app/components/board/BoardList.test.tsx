import { MemoryRouter } from "react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import BoardList from "./BoardList";
import type { Card } from "~/lib/api-types";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));

const card = (id: string, title: string, over: Partial<Card["initiative"]> = {}, raised = 0) =>
  ({
    initiative: {
      id,
      slug: `slug-${id}`,
      title,
      summary: "",
      goalUsd: 200_000,
      status: "approved",
      type: "grant",
      sortRank: null,
      safeAddress: "",
      categories: ["opsec"],
      createdAt: 0,
      approvedAt: null,
      ...over,
    },
    summary: {
      pledged: 0,
      received: 0,
      donated: 0,
      total: raised,
      live: false,
      ledger: 0,
      paidOut: 0,
    },
    pct: (raised / 200_000) * 100,
    backers: raised ? 3 : 0,
    donations: 0,
    ledger: null,
    logos: [],
    funded: false,
    donationsEnabled: false,
  }) as unknown as Card;

const cards = [
  card("a", "Echidna fuzzing", {}, 100_000),
  card("b", "Safe Lockdown Guard", { type: "rfp", approvedAt: Date.now() / 1000 - 86400 }),
];

const mount = (props: Partial<Parameters<typeof BoardList>[0]> = {}) =>
  render(
    <MemoryRouter>
      <BoardList cards={cards} {...props} />
    </MemoryRouter>,
  );

it("one row per initiative: type, linked title, funded %, raised of goal", () => {
  mount();
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  const first = within(rows[0]);
  expect(first.getAllByText(/^grant$/i).length).toBeGreaterThan(0); // desktop cell + phone line
  expect(first.getByRole("link", { name: "Echidna fuzzing" })).toHaveAttribute(
    "href",
    "/initiative/slug-a",
  );
  expect(first.getAllByText("50.0%").length).toBeGreaterThan(0); // column + phone bar end
  expect(first.getByText("$100,000")).toBeInTheDocument();
  expect(first.getByText(/of \$200,000/)).toBeInTheDocument();
  expect(first.getByText("$100k")).toBeInTheDocument(); // phones: the short form
  // the backers are read out with the amount; the tooltip is for sighted users
  expect(first.getByText(/, 3 backers/)).toBeInTheDocument();
  expect(within(rows[1]).queryByText(/, \d+ backer/)).toBeNull(); // none yet: no count on the amount
  expect(within(rows[1]).getByText("No backers yet")).toBeInTheDocument(); // the Backers column
});

it("the columns are named once, above the rows", () => {
  mount();
  for (const name of ["Type", "Initiative", "Funded", "Backers", "Raised"]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
});

it("every row sits on the list's shared columns", () => {
  const { container } = mount();
  for (const li of container.querySelectorAll("li")) {
    expect(li.className).toContain("grid-cols-subgrid");
  }
});

it("rows carry the card's labels (the Featured pin, then AI pick or New)", () => {
  mount({ aiTop: ["a"] });
  const rows = screen.getAllByRole("listitem");
  // beside the title on desktop, beside the type on phones
  expect(within(rows[0]).getAllByText("AI pick")).toHaveLength(2);
  expect(within(rows[1]).getAllByText("New")).toHaveLength(2);
});

it("the bookmark adds to the watchlist from the list too", () => {
  const toggle = vi.fn();
  mount({ watch: { has: (id) => id === "a", toggle } });
  const rows = screen.getAllByRole("listitem");
  const on = within(rows[0]).getByRole("button", {
    name: "Remove Echidna fuzzing from watchlist",
  });
  expect(on).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(rows[1]).getByRole("button", { name: /Add Safe Lockdown Guard/ }));
  expect(toggle).toHaveBeenCalledWith("b");
});

it("each row carries its own funding bar, filled as far as it is funded", () => {
  const { container } = mount();
  const [funded, none] = container.querySelectorAll("li");
  expect((funded.querySelector("[data-funding-fill]") as HTMLElement).style.width).toBe("50%");
  expect(none.querySelector("[data-funding-fill]")).toBeNull(); // nothing raised: the bare track
});

it("compact (a list under 720px, as on phones): the backers after the amount, no popover", () => {
  mount();
  const row = screen.getAllByRole("listitem")[0];
  // Nobody pledged: how many, in the Backers column and on the compact line.
  expect(within(row).getAllByText("3")).toHaveLength(2);
  // The amount is plain text, nothing to tap.
  expect(row.querySelector("[tabindex='0']")).toBeNull();
});

it("desktop: the amount is plain text, the Backers column says it", () => {
  mount();
  const row = screen.getAllByRole("listitem")[0];
  const amount = [...row.querySelectorAll("span")].find((e) =>
    e.textContent?.startsWith("$100,000 of $200,000")
  )!;
  expect(amount).not.toHaveAttribute("tabindex");
});

it("desktop: the Backers column shows the pledgers' logos, and +N for the backers beyond them", () => {
  const logo = (company: string) => ({ company, logoUrl: `https://x/${company}.png`, url: "" });
  const withLogos = (n: number, backers: number) =>
    ({ ...cards[0], backers, logos: ["A", "B", "C", "D"].slice(0, n).map(logo) }) as Card;
  const { unmount } = mount({ cards: [withLogos(1, 4)] });
  let row = within(screen.getByRole("listitem"));
  expect(row.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual(["A"]);
  // The column, and the compact line's copy after the amount (hidden from screen readers:
  // the amount already says how many backers).
  expect(row.getAllByText("+3")).toHaveLength(2);
  expect(row.getByText("4 backers")).toHaveClass("sr-only");
  unmount();
  // four logos fill the column: with more backers than that, three and the rest as +N
  const second = mount({ cards: [withLogos(4, 6)] });
  row = within(screen.getByRole("listitem"));
  expect(row.getAllByRole("img")).toHaveLength(3);
  expect(row.getAllByText("+3")).toHaveLength(2);
  second.unmount();
  // the logos are all the backers: no +N
  mount({ cards: [withLogos(4, 4)] });
  row = within(screen.getByRole("listitem"));
  expect(row.getAllByRole("img")).toHaveLength(4);
  expect(row.queryByText(/^\+/)).toBeNull();
});

it("the last row's vote callout hangs below the list, so nothing around it clips", () => {
  const { container } = mount({ vote: { show: true, floorPct: 25, capUsd: 200_000 } });
  const last = [...container.querySelectorAll("li")].at(-1)!;
  fireEvent.click(last);
  const callout = last.querySelector("[data-vote-callout]")!;
  expect(callout).toHaveTextContent("$50k to qualify");
  for (let el = callout.parentElement; el && el !== container; el = el.parentElement) {
    expect(el.className).not.toMatch(/\boverflow-(hidden|clip|auto|scroll)\b/);
  }
});

it("draws the vote's share as a second segment after the raised part", () => {
  const { container } = mount({ votePct: new Map([["a", 30]]) });
  const fills = container.querySelectorAll("[data-vote-fill]");
  expect(fills).toHaveLength(1);
  expect((fills[0] as HTMLElement).style.left).toBe("50%");
  expect((fills[0] as HTMLElement).style.width).toBe("30%");
});

it("draws the settling tier's share after the settled one, lighter", () => {
  const { container } = mount({
    votePct: new Map([["a", 30]]),
    votePendingPct: new Map([["a", 10]]),
  });
  const gold = container.querySelector<HTMLElement>("[data-vote-fill]")!;
  const pending = container.querySelector<HTMLElement>("[data-vote-pending]")!;
  expect([gold.style.left, gold.style.width]).toEqual(["50%", "20%"]);
  expect([pending.style.left, pending.style.width]).toEqual(["70%", "10%"]);
});

it("caps raised plus the vote's share at the full bar", () => {
  const { container } = mount({ votePct: new Map([["a", 80]]) });
  expect((container.querySelector("[data-vote-fill]") as HTMLElement).style.width).toBe("50%");
});

it("draws no vote segment without votePct", () => {
  const { container } = mount();
  expect(container.querySelector("[data-vote-fill]")).toBeNull();
});

it("a completed vote result keeps an accessible funding label", () => {
  mount({ votePct: new Map([["a", 50]]) });
  const row = screen.getByText("Echidna fuzzing").closest("li")!;
  expect(within(row).getAllByTitle("Funded with the vote").length).toBeGreaterThan(0);
  for (const label of within(row).getAllByText("Funded with the vote")) {
    expect(label).toHaveClass("sr-only");
  }
  expect(within(row).queryByText("Funded", { exact: true })).toBeNull();
  expect(within(row).queryByText("50%")).toBeNull();
  cleanup();
  mount({ votePct: new Map([["a", 30]]) });
  expect(
    within(screen.getByText("Echidna fuzzing").closest("li")!)
      .queryAllByTitle("Funded with the vote"),
  )
    .toHaveLength(0);
});

it("shows result tiers only for initiatives funded by the DAO vote", () => {
  mount({
    votePct: new Map([["a", 50]]),
    voteTiers: new Map([["a", "A"], ["b", "B"]]),
  });
  const first = screen.getByText("Echidna fuzzing").closest("li")!;
  expect(within(first).getAllByText("Tier-A").length).toBeGreaterThan(0);
  expect(screen.queryByText("Tier-B")).toBeNull();
});

it("shows a Funded chip for existing support, without a DAO tier", () => {
  mount({ cards: [card("paid", "Already funded", {}, 200_000)] });
  const row = screen.getByText("Already funded").closest("li")!;
  expect(within(row).getAllByTitle("Fully funded from existing support").length).toBeGreaterThan(0);
  expect(within(row).getAllByText("FUNDED").length).toBeGreaterThan(0);
  expect(within(row).queryByText(/^Tier-[SAB]$/)).toBeNull();
  expect(within(row).queryByText("100.0%")).toBeNull();
});

// The vote results: a row raised $0 of a $44k ask, $23k from Tier-S, and a Tier-S row.
const voteCards = [
  card("x", "Tier-A row", { goalUsd: 44_000, slug: "x" }),
  card("y", "Tier-S row", { goalUsd: 44_000, slug: "y" }),
];
const toS = {
  tier: "S" as const,
  gap: "23000000000",
  comesIn: [],
  dropsOut: [{ slug: "y", tier: "S" as const }],
  moves: [],
};
const mountVote = () =>
  mount({
    cards: voteCards,
    voteTiers: new Map([["x", "A"], ["y", "S"]]),
    votePct: new Map([["x", 100], ["y", 100]]),
    next: new Map([["x", toS]]),
    lead: new Map([["y", "46000000000"]]),
    titles: new Map([["x", "Tier-A row"], ["y", "Tier-S row"]]),
  });
const rowOf = (title: string) => screen.getByText(title).closest("li")!;

it("the vote results: a tick where the next tier is reached, its callout on hover", () => {
  mountVote();
  const row = rowOf("Tier-A row");
  const tick = row.querySelector<HTMLElement>("[data-vote-tick][data-what-if]")!;
  // (0 + $23k) / $44k
  expect(parseFloat(tick.style.left)).toBeCloseTo(52.3, 1);
  expect(row.querySelector("[data-vote-callout]")).toBeNull();
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  const callout = row.querySelector("[data-vote-callout]")!;
  expect(callout).toHaveTextContent("$23k to Tier-S");
  expect(callout).toHaveTextContent("Drops out: Tier-S row (Tier-S)");
  fireEvent.pointerLeave(row, { pointerType: "mouse" });
  expect(row.querySelector("[data-vote-callout]")).toBeNull();
});

it("the vote results: Tier-S has no tick, its lead at the bar's end", () => {
  mountVote();
  const row = rowOf("Tier-S row");
  expect(row.querySelector("[data-vote-tick]")).toBeNull();
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  const callout = row.querySelector<HTMLElement>("[data-vote-callout]")!;
  expect(callout).toHaveTextContent("$46k ahead");
  expect(callout).toHaveTextContent(
    "Its backers could give this much less between them and it would still be funded in Tier-S.",
  );
  expect(callout.style.right).toBe("calc(0% - 14px)");
});

it("the vote results' list has no Funded column, and no figure looks like a link", () => {
  const { container } = mountVote();
  expect(screen.queryByText("Funded")).toBeNull();
  for (const name of ["Type", "Initiative", "Backers", "Raised"]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
  // The rows drop the cell too: its grid has one column fewer than the board's.
  expect(
    container.querySelector(".grid-cols-\\[2rem_4\\.25rem_minmax\\(0\\,1fr\\)_5\\.5rem_11rem\\]"),
  )
    .not.toBeNull();
  expect(screen.queryByText(/needed/i)).toBeNull();
  for (const row of screen.getAllByRole("listitem")) {
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
  }
  expect(screen.queryByRole("button", { name: /to Tier-|ahead/ })).toBeNull();
  expect(container.querySelector(".cursor-help, .underline, .decoration-dotted")).toBeNull();
});

it("the board's list keeps its Funded column", () => {
  const { container } = mount();
  expect(screen.getByText("Funded")).toBeInTheDocument();
  expect(container.querySelector("[data-what-if]")).toBeNull();
});
