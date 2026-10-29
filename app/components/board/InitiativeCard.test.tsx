import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InitiativeCard, { DonateStandIn } from "./InitiativeCard";
import type { Card } from "~/lib/api-types";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => <p>donate widget</p> }));
const postReview = vi.fn();
vi.mock("~/hooks/use-admin-ratings", () => ({ usePostReview: () => postReview }));
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

it("a featured new card shows the pin and New", () => {
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
  expect(screen.getByText("New")).toBeInTheDocument();
});

it("the top edge: AI pick or New, then the Featured pin; AI pick over New", () => {
  const base = card({}).initiative;
  const fresh = card({ initiative: { ...base, approvedAt: Date.now() / 1000 - 86400 } });
  // In the order they appear on the top edge.
  const labels = () =>
    ["AI pick", "Featured", "New"]
      .map((t) => [t, screen.queryByText(t)] as const)
      .filter(([, el]) => el)
      .sort(([, a], [, b]) =>
        a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )
      .map(([t]) => t);
  const view = (props: { aiTop?: boolean; featured?: boolean }) =>
    render(
      <MemoryRouter>
        <InitiativeCard card={fresh} tokensOk={false} {...props} />
      </MemoryRouter>,
    );
  let v = view({ aiTop: true, featured: true });
  expect(labels()).toEqual(["AI pick", "Featured"]);
  v.unmount();
  v = view({ aiTop: true });
  expect(labels()).toEqual(["AI pick"]); // never with New
  v.unmount();
  v = view({ featured: true });
  expect(labels()).toEqual(["New", "Featured"]);
  v.unmount();
  view({});
  expect(labels()).toEqual(["New"]);
});

describe("vote eligibility", () => {
  const vote = { show: true, floorPct: 25, capUsd: 200_000 };
  const raised = (total: number) =>
    card({ summary: { ...card({}).summary, total }, pct: total / 10 });

  it("off: no mark on the bar, the plain bar", () => {
    const { container } = render(
      <MemoryRouter>
        <InitiativeCard card={raised(100)} tokensOk vote={{ ...vote, show: false }} />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-vote-tick]")).toBeNull();
  });

  it("on: a mark at the floor, and the bar tells screen readers how far it is", () => {
    const { container } = render(
      <MemoryRouter>
        <InitiativeCard card={raised(100)} tokensOk vote={vote} />
      </MemoryRouter>,
    );
    expect(container.querySelector<HTMLElement>("[data-vote-tick]")!.style.left).toBe("25%");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "10.0% funded. $150 to qualify for TheDAO's vote",
    );
    expect(screen.queryByText(/Qualified for the vote|to qualify$/)).toBeNull();
  });
});

describe("rating from the board (admins)", () => {
  const rated = { avg: 4.3, count: 3, dist: [0, 0, 0, 2, 1] as [0, 0, 0, 2, 1], mine: 4 as const };
  const mountRated = (summary?: typeof rated) =>
    render(
      <MemoryRouter>
        <InitiativeCard
          card={card({ donationsEnabled: true })}
          tokensOk
          rating={{ summary }}
        />
      </MemoryRouter>,
    );

  it("the chip unfolds the form under the card, like Donate, one panel at a time", async () => {
    postReview.mockReset().mockResolvedValue(undefined);
    mountRated(rated);
    const chip = screen.getByRole("button", { name: /Voting NFT average 4.3 from 3 voting NFTs/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    // Starts from the viewer's current rating.
    expect(screen.getByRole("radio", { name: "4 stars" })).toHaveAttribute("aria-checked", "true");
    // The chip folds it again, its chevron turned up while open.
    expect(chip.querySelector(".rotate-180")).not.toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull());
    expect(chip.querySelector(".rotate-180")).toBeNull();
    fireEvent.click(chip);
    // Donate takes the place of the rating form.
    fireEvent.click(screen.getByRole("button", { name: "Donate" }));
    await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull());
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: "Donate" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Average 4.3 of 5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "2 stars" }));
    // The average counts the new pick in place of the old one: (4 + 5 + 2) / 3.
    expect(screen.getByRole("img", { name: "Average 3.7 of 5" })).toBeInTheDocument();
    // Write review opens the text, focused, in the stars' place.
    fireEvent.click(screen.getByRole("button", { name: "Write review" }));
    const box = screen.getByPlaceholderText("Why this rating? (optional)");
    expect(box).toHaveFocus();
    // The pencil stays, lit, to fold the text away again.
    const write = screen.getByRole("button", { name: "Write review" });
    expect(write).toHaveAttribute("aria-pressed", "true");
    // Writing, Send is its icon alone and the stars get smaller, to keep their room.
    expect(screen.getByRole("button", { name: "Send" })).not.toHaveTextContent("Send");
    expect(screen.getByRole("radio", { name: "2 stars" })).toHaveClass("size-5");
    fireEvent.change(box, { target: { value: " Too vague " } });
    // Folded and opened again, the text is still there.
    fireEvent.click(write);
    expect(screen.queryByPlaceholderText("Why this rating? (optional)")).toBeNull();
    expect(write).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(write);
    expect(screen.getByPlaceholderText("Why this rating? (optional)")).toHaveValue(" Too vague ");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(postReview).toHaveBeenCalledWith("1", 2, "Too vague"));
    await waitFor(() => expect(chip).toHaveAttribute("aria-expanded", "false"));
  });

  it.each([1, 2])("hides the chip and draft average with %s saved reviewers", (count) => {
    mountRated({ ...rated, count });
    const chip = screen.getByRole("button", { name: /average shown after 3 reviewers/ });
    expect(chip).not.toHaveTextContent("4.3");
    expect(chip.title).not.toContain("4.3");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    expect(screen.getByRole("img", { name: "Average shown after 3 reviewers" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^Average \d/ })).toBeNull();
  });

  it("Send waits for stars, sends stars alone, and an error keeps the form open", async () => {
    postReview.mockReset().mockRejectedValue(
      new Error("only initiatives on the board can be rated"),
    );
    mountRated();
    fireEvent.click(screen.getByRole("button", { name: /No voting NFT rated it yet/ }));
    expect(screen.getByRole("img", { name: "Average shown after 3 reviewers" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    expect(screen.queryByRole("img", { name: "Average 5 of 5" })).toBeNull();
    expect(screen.getByRole("img", { name: "Average shown after 3 reviewers" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/only initiatives on the board/i)).toBeInTheDocument();
    expect(postReview).toHaveBeenCalledWith("1", 5, "");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});
