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
  expect(screen.getByLabelText("Vote environment")).toHaveTextContent("Vote · Ethereum");
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
