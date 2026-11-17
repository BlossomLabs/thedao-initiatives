import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { VoteEnvironmentContext } from "~/lib/vote-round";
import TopBar from "./TopBar";

const state = vi.hoisted(() => ({
  deployed: true,
  badges: [7] as number[],
}));
vi.mock("~/components/wallet/ConnectButton", () => ({ default: () => null }));
vi.mock("~/components/wallet/WatchlistOfferSlot", () => ({ default: () => null }));
vi.mock("~/context/session", () => ({ useSession: () => ({ session: { address: "0x1" } }) }));
vi.mock("~/hooks/use-vote", () => ({ useMyBadges: () => ({ data: state.badges }) }));
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

it("links a badge holder to the vote and its results (#124)", () => {
  mount("/vote/ballot");
  expect(desktop().getByRole("link", { name: "Vote" })).toHaveAttribute(
    "href",
    "/vote/ballot/edit",
  );
  // On the ballot's pages Vote is the current one, Results isn't.
  expect(desktop().getByRole("link", { name: "Vote" })).toHaveAttribute("aria-current", "page");
  expect(desktop().getByRole("link", { name: "Results" })).toHaveAttribute("href", "/vote");
  expect(desktop().getByRole("link", { name: "Results" })).not.toHaveAttribute("aria-current");
});

it("on the test vote the links go to the test vote", () => {
  mount("/vote-test", "test");
  expect(desktop().getByRole("link", { name: "Vote" })).toHaveAttribute(
    "href",
    "/vote-test/ballot/edit",
  );
  expect(desktop().getByRole("link", { name: "Results" })).toHaveAttribute("aria-current", "page");
});

it("without a badge only Results; without a round, neither", () => {
  state.badges = [];
  mount("/");
  expect(desktop().queryByRole("link", { name: "Vote" })).toBeNull();
  expect(desktop().getByRole("link", { name: "Results" })).toBeInTheDocument();
  state.deployed = false;
  mount("/");
  expect(screen.getAllByRole("navigation", { name: "Site" }).at(-1)!.querySelectorAll("a"))
    .toHaveLength(2);
});
