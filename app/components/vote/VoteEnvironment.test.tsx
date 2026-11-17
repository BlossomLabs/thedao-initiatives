import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it } from "vitest";
import { VoteEnvironmentBanner, VoteEnvironmentProvider } from "./VoteEnvironment";
import { useVoteEnvironment } from "~/lib/vote-round";
import { useState } from "react";
afterEach(cleanup);
function Draft() {
  const env = useVoteEnvironment();
  const [draft, setDraft] = useState("");
  return (
    <input
      aria-label={`${env} draft`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}
it("switching environments changes the label and starts a separate draft", () => {
  render(
    <MemoryRouter initialEntries={["/vote-test/ballot"]}>
      <VoteEnvironmentProvider>
        <VoteEnvironmentBanner />
        <Draft />
      </VoteEnvironmentProvider>
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Vote environment")).toHaveTextContent("Test vote · Sepolia");
  expect(screen.getByText(/Does not affect the vote.s allocations/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("test draft"), { target: { value: "test selections" } });
  fireEvent.click(screen.getByRole("link", { name: "Open the vote" }));
  // The vote's own pages carry no banner.
  expect(screen.queryByLabelText("Vote environment")).toBeNull();
  expect(screen.getByLabelText("production draft")).toHaveValue("");
});
it("example results are visibly marked as a demonstration", () => {
  render(
    <MemoryRouter initialEntries={["/vote-test/results/s-settling"]}>
      <VoteEnvironmentProvider>
        <VoteEnvironmentBanner />
      </VoteEnvironmentProvider>
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Vote environment")).toHaveTextContent("Demonstration");
});
it("the vote's pages have no banner; Admin keeps it, with its link to the test vote", () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={["/vote"]}>
      <VoteEnvironmentProvider>
        <VoteEnvironmentBanner />
      </VoteEnvironmentProvider>
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText("Vote environment")).toBeNull();
  unmount();
  render(
    <MemoryRouter initialEntries={["/admin/vote"]}>
      <VoteEnvironmentProvider>
        <VoteEnvironmentBanner />
      </VoteEnvironmentProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Open test vote" })).toHaveAttribute(
    "href",
    "/admin/vote-test",
  );
});
it("the front page has no vote banner", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <VoteEnvironmentProvider>
        <VoteEnvironmentBanner />
      </VoteEnvironmentProvider>
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText("Vote environment")).toBeNull();
});
