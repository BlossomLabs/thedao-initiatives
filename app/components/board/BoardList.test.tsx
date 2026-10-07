import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const phoneScreen = (on: boolean) => {
  globalThis.matchMedia = ((query: string) => ({
    matches: on && query === "(max-width: 640px)",
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof matchMedia;
};

it("phones: tapping the amount shows its backers, in the tooltip style", async () => {
  phoneScreen(true);
  mount();
  const amount = [...screen.getAllByRole("listitem")[0].querySelectorAll("[tabindex='0']")]
    .find((e) => e.textContent?.includes(" of $")) as HTMLElement;
  expect(amount).toHaveTextContent("$100,000 of $200,000");
  fireEvent.click(amount); // a tap on phones and touch screens
  expect(await screen.findByText("3 backers", { selector: "div" })).toBeInTheDocument();
  phoneScreen(false);
});

it("desktop: the amount is plain text, the Backers column says it", () => {
  phoneScreen(false);
  mount();
  const row = screen.getAllByRole("listitem")[0];
  const amount = [...row.querySelectorAll("span")].find((e) =>
    e.textContent?.startsWith("$100,000 of $200,000")
  )!;
  expect(amount).not.toHaveAttribute("tabindex");
});
