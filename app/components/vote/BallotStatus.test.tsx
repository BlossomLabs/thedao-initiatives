import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { BallotPhase } from "~/lib/vote-flow";
import BallotStatus, { etherscanTx, type SendRoute } from "./BallotStatus";

afterEach(cleanup);

const HASH = `0x${"ab".repeat(32)}` as const;

function panel(
  phase: BallotPhase,
  o: { route?: SendRoute; upToDate?: boolean; canSend?: boolean; chain?: "Ethereum" } = {},
) {
  const on = { onSend: vi.fn(), onSelfSend: vi.fn(), onRetry: vi.fn() };
  render(
    <MemoryRouter>
      <BallotStatus
        phase={phase}
        route={o.route ?? "relay"}
        chain={o.chain}
        upToDate={o.upToDate ?? false}
        canSend={o.canSend ?? true}
        sendLabel="Send my ballot"
        resultsHref="/"
        {...on}
      />
    </MemoryRouter>,
  );
  const steps = () =>
    within(screen.getByRole("list", { name: "Sending your ballot" })).getAllByRole("listitem")
      .map((li) => li.textContent);
  const button = (name: string | RegExp) => screen.getByRole("button", { name });
  return { ...on, steps, button };
}

it("ready: three steps to come, and Send", () => {
  const p = panel({ kind: "idle" });
  expect(p.steps()).toEqual(["1Sign", "2Send", "3Review"]);
  fireEvent.click(p.button("Send my ballot"));
  expect(p.onSend).toHaveBeenCalled();
  fireEvent.click(p.button(/send it yourself/i));
  expect(p.onSelfSend).toHaveBeenCalled();
});

it("each wait keeps the button, disabled, saying what it waits for", () => {
  let p = panel({ kind: "signing" });
  expect(p.button("Waiting for your signature…")).toBeDisabled();
  cleanup();
  p = panel({ kind: "relaying" });
  expect(p.steps()).toEqual(["Signed", "2Send", "3Review"]);
  expect(p.button("Sending…")).toBeDisabled();
  expect(screen.getByText("TheDAO is sending it")).toBeInTheDocument();
  cleanup();
  p = panel({ kind: "relaying" }, { route: "own" });
  expect(screen.getByText("Confirm the transaction in your wallet")).toBeInTheDocument();
  expect(p.button("Waiting for you to confirm…")).toBeDisabled();
  cleanup();
  p = panel({ kind: "waiting", hash: HASH }, { chain: "Ethereum" });
  expect(p.steps()).toEqual(["Signed", "Sent", "3Review"]);
  expect(p.button("Waiting for Ethereum…")).toBeDisabled();
  expect(screen.getByText(/counts once mined, even if you close this page/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /on Etherscan/ }))
    .toHaveAttribute("href", `https://etherscan.io/tx/${HASH}`);
});

it("counted: all three done, the button says Counted; a changed ballot can be sent again", () => {
  let p = panel({ kind: "counted", hash: HASH }, { upToDate: true });
  expect(p.steps()).toEqual(["Signed", "Sent", "Reviewed"]);
  expect(p.button("Counted")).toBeDisabled();
  expect(screen.getByRole("link", { name: "See the live results" })).toHaveAttribute("href", "/");
  cleanup();
  p = panel({ kind: "counted", hash: HASH }, { upToDate: false });
  expect(p.button("Send my ballot")).toBeEnabled();
});

it("a ballot that already counts, on a fresh page, shows as counted (no transaction to link)", () => {
  const p = panel({ kind: "idle" }, { upToDate: true });
  expect(p.button("Counted")).toBeDisabled();
  expect(screen.queryByRole("link", { name: /Etherscan/ })).toBeNull();
});

it("not signed: nothing was sent, Send again", () => {
  const p = panel({ kind: "idle", note: "You didn't sign, so nothing was sent." });
  expect(p.steps()[0]).toBe("Not signed");
  expect(screen.getByText("Nothing was sent")).toBeInTheDocument();
  expect(p.button("Send my ballot")).toBeEnabled();
});

it("failures say which step and what next, with the transaction when there is one", () => {
  // Mined but refused: × at Review, Retry, and the transaction.
  let p = panel({ kind: "failed", reason: "The transaction failed on-chain.", hash: HASH });
  expect(p.steps()).toEqual(["Signed", "Sent", "Not counted"]);
  fireEvent.click(p.button("Retry"));
  expect(p.onRetry).toHaveBeenCalled();
  expect(screen.getByRole("link", { name: /Etherscan/ })).toBeInTheDocument();
  cleanup();

  // Too slow: it may still land, so Check again (Retry reads the chain first).
  p = panel({ kind: "failed", reason: "It's taking too long to be mined.", hash: HASH });
  expect(p.steps()[2]).toBe("?Not mined yet");
  expect(p.button("Check again")).toBeEnabled();
  cleanup();

  // After the close: it doesn't count, nothing more to send.
  p = panel({ kind: "late", hash: HASH });
  expect(p.button("Voting has closed")).toBeDisabled();
});

it("a send that fails at Send says it never left, and offers your own wallet", () => {
  const props = {
    route: "relay" as const,
    upToDate: false,
    canSend: true,
    sendLabel: "Send my ballot",
    resultsHref: "/",
    onSend: vi.fn(),
    onSelfSend: vi.fn(),
    onRetry: vi.fn(),
  };
  const { rerender } = render(
    <MemoryRouter>
      <BallotStatus phase={{ kind: "relaying" }} {...props} />
    </MemoryRouter>,
  );
  rerender(
    <MemoryRouter>
      <BallotStatus phase={{ kind: "failed", reason: "Free sends used up." }} {...props} />
    </MemoryRouter>,
  );
  expect(screen.getByText("It never left")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(screen.getByRole("button", { name: /send it yourself/i })).toBeEnabled();
});

it("test votes link to Sepolia's Etherscan", () => {
  expect(etherscanTx(HASH)).toBe(`https://sepolia.etherscan.io/tx/${HASH}`);
  expect(etherscanTx(HASH, "Ethereum")).toBe(`https://etherscan.io/tx/${HASH}`);
});

it("a failure right after Sign (no transaction) is at Sign: Try again", () => {
  const props = {
    route: "relay" as const,
    upToDate: false,
    canSend: true,
    sendLabel: "Send my ballot",
    resultsHref: "/",
    onSend: vi.fn(),
    onSelfSend: vi.fn(),
    onRetry: vi.fn(),
  };
  const { rerender } = render(
    <MemoryRouter>
      <BallotStatus phase={{ kind: "signing" }} {...props} />
    </MemoryRouter>,
  );
  rerender(
    <MemoryRouter>
      <BallotStatus
        phase={{ kind: "failed", reason: "The wallet is on another chain." }}
        {...props}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("It couldn’t be signed")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(props.onSend).toHaveBeenCalled();
});

it("in the editor, a ballot that counts offers to see it: a primary button", () => {
  const onSeeBallot = vi.fn();
  render(
    <MemoryRouter>
      <BallotStatus
        phase={{ kind: "idle" }}
        route="relay"
        upToDate
        canSend
        sendLabel="Send my ballot"
        resultsHref="/"
        onSend={vi.fn()}
        onSelfSend={vi.fn()}
        onRetry={vi.fn()}
        onSeeBallot={onSeeBallot}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: "Counted" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "See my ballot" }));
  expect(onSeeBallot).toHaveBeenCalled();
});
