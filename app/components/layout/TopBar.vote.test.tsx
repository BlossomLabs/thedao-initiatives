import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { VoteEnvironmentContext } from "~/lib/vote-round";
import TopBar from "./TopBar";

const state = vi.hoisted(() => ({
  deployed: true,
  badges: [7] as number[],
  /** The most initiatives new to a badge since its last send, as /api/vote/mine says. */
  fresh: 0,
}));
vi.mock("~/components/wallet/ConnectButton", () => ({ default: () => null }));
vi.mock("~/components/wallet/WatchlistOfferSlot", () => ({ default: () => null }));
vi.mock("~/context/session", () => ({ useSession: () => ({ session: { address: "0x1" } }) }));
vi.mock("~/hooks/use-vote", () => ({
  useMyBadges: () => ({ data: state.badges }),
  useBallotNews: () => ({ data: state.fresh }),
}));
vi.mock("~/lib/vote-round", async (orig) => ({
  ...(await orig<typeof import("~/lib/vote-round")>()),
  useRoundLoaded: () => true,
  useRound: () => ({
    contract: state.deployed ? "0x717864ECEA403902e21C04EE23ea990C03a07C76" : `0x${"0".repeat(40)}`,
  }),
}));
afterEach(() => {
  state.deployed = true;
  state.badges = [7];
  state.fresh = 0;
});

const mount = (path: string, env: "production" | "test" = "production") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <VoteEnvironmentContext.Provider value={env}>
        <TopBar />
      </VoteEnvironmentContext.Provider>
    </MemoryRouter>,
  );
const desktop = () => within(screen.getAllByRole("navigation", { name: "Site" })[0]);

it("links to the vote's results and a badge holder's ballot (#124)", () => {
  mount("/vote/ballot");
  expect(desktop().getByRole("link", { name: "My ballot" })).toHaveAttribute(
    "href",
    "/vote/ballot",
  );
  // On the ballot's pages My ballot is the current one, Vote isn't.
  expect(desktop().getByRole("link", { name: "My ballot" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(desktop().getByRole("link", { name: "Vote" })).toHaveAttribute("href", "/vote");
  expect(desktop().getByRole("link", { name: "Vote" })).not.toHaveAttribute("aria-current");
  // Vote comes first.
  expect(desktop().getAllByRole("link").map((l) => l.textContent).slice(-2)).toEqual([
    "Vote",
    "My ballot",
  ]);
});

it("the ballot's editor is My ballot too", () => {
  mount("/vote/ballot/edit");
  expect(desktop().getByRole("link", { name: "My ballot" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("on the test vote the links go to the test vote", () => {
  mount("/vote-test", "test");
  expect(desktop().getByRole("link", { name: "My ballot" })).toHaveAttribute(
    "href",
    "/vote-test/ballot",
  );
  expect(desktop().getByRole("link", { name: "Vote" })).toHaveAttribute("aria-current", "page");
});

it("without a badge only Vote; without a round, neither", () => {
  state.badges = [];
  mount("/");
  expect(desktop().queryByRole("link", { name: "My ballot" })).toBeNull();
  expect(desktop().getByRole("link", { name: "Vote" })).toHaveAttribute("href", "/vote");
  state.deployed = false;
  mount("/");
  expect(screen.getAllByRole("navigation", { name: "Site" }).at(-1)!.querySelectorAll("a"))
    .toHaveLength(2);
});

it("My ballot carries how many initiatives are new since the ballot was sent", () => {
  state.fresh = 3;
  mount("/vote");
  const link = desktop().getByRole("link", { name: /My ballot/ });
  expect(link).toHaveTextContent("My ballot3 new initiatives");
});

it("no chip with nothing new", () => {
  mount("/vote");
  expect(desktop().getByRole("link", { name: "My ballot" })).toBeInTheDocument();
});
