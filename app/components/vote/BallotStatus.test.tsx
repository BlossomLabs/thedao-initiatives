import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { BallotPhase } from "~/lib/vote-flow";
import BallotStatus, { explorerTx, type SendRoute } from "./BallotStatus";

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
  const button = (name: string | RegExp) => screen.getByRole("button", { name });
  return { ...on, button };
}

it("ready: no stepper, just Send", () => {
  const p = panel({ kind: "idle" });
  expect(screen.queryByRole("list")).toBeNull();
  fireEvent.click(p.button("Send my ballot"));
  expect(p.onSend).toHaveBeenCalled();
  fireEvent.click(p.button(/send it yourself/i));
  expect(p.onSelfSend).toHaveBeenCalled();
});

it("each wait keeps the button, disabled, saying what it waits for", () => {
  let p = panel({ kind: "signing" });
  expect(p.button("Waiting for your signature…")).toBeDisabled();
  cleanup();
  // TheDAO's send is too quick to read: it shows as the wait for the chain, no link yet.
  p = panel({ kind: "relaying" });
  expect(p.button("Waiting for Sepolia…")).toBeDisabled();
  expect(screen.getByText("Waiting for Sepolia to record it")).toBeInTheDocument();
  expect(screen.queryByText(/Already sent/)).toBeNull();
  cleanup();
  p = panel({ kind: "relaying" }, { route: "own" });
  expect(screen.getByText("Confirm the transaction in your wallet")).toBeInTheDocument();
  expect(p.button("Waiting for you to confirm…")).toBeDisabled();
  cleanup();
  p = panel({ kind: "waiting", hash: HASH }, { chain: "Ethereum" });
  expect(p.button("Waiting for Ethereum…")).toBeDisabled();
  expect(screen.getByText(/tally checks whether it counts after it is recorded/))
    .toBeInTheDocument();
  expect(screen.getByRole("link", { name: /on Ethereum/ }))
    .toHaveAttribute("href", `https://eth.blockscout.com/tx/${HASH}`);
});

it("counted: the button says Counted; a changed ballot can be sent again", () => {
  let p = panel({ kind: "counted", hash: HASH }, { upToDate: true });
  expect(screen.getByText("Your ballot counts")).toBeInTheDocument();
  expect(p.button("Counted")).toBeDisabled();
  expect(screen.getByRole("link", { name: "See the live results" })).toHaveAttribute("href", "/");
  // The transaction is linked in the counted box, from where it was recorded.
  const box = screen.getByText("Your ballot counts").parentElement!;
  expect(box).toHaveTextContent(
    "Your ballot was recorded on Sepolia (0x" + HASH.slice(2, 6) + "…" + HASH.slice(-4) +
      ").You can still adjust your ballot and resubmit.",
  );
  expect(within(box).getByRole("link", { name: /^Sepolia, transaction 0x/ }))
    .toHaveAttribute("href", `https://eth-sepolia.blockscout.com/tx/${HASH}`);
  cleanup();
  p = panel({ kind: "counted", hash: HASH }, { upToDate: false });
  expect(p.button("Send my ballot")).toBeEnabled();
});

it("a ballot that already counts, on a fresh page, shows as counted (no transaction to link)", () => {
  const p = panel({ kind: "idle" }, { upToDate: true });
  expect(p.button("Counted")).toBeDisabled();
  expect(screen.queryByRole("link", { name: /transaction|0x/ })).toBeNull();
  expect(screen.getByText(/Your ballot was recorded on Sepolia\./)).toBeInTheDocument();
});

it("not signed: nothing was sent, Send again", () => {
  const p = panel({ kind: "idle", note: "You didn't sign, so nothing was sent." });
  expect(screen.getByText("Nothing was sent")).toBeInTheDocument();
  expect(p.button("Send my ballot")).toBeEnabled();
});

it("failures say what went wrong and what next, with the transaction when there is one", () => {
  // Mined but refused: × at Review, Retry, and the transaction.
  let p = panel({ kind: "failed", reason: "The transaction failed on-chain.", hash: HASH });
  expect(screen.getByText("Sepolia refused it")).toBeInTheDocument();
  fireEvent.click(p.button("Retry"));
  expect(p.onRetry).toHaveBeenCalled();
  // In the box, under its message, not below the button.
  expect(screen.getByText("Sepolia refused it").parentElement!).toContainElement(
    screen.getByRole("link", { name: /^Transaction 0x.* on Sepolia$/ }),
  );
  cleanup();

  // Too slow: it may still land, so Check again (Retry reads the chain first).
  p = panel({ kind: "failed", reason: "It's taking too long to be mined.", hash: HASH });
  expect(screen.getByText("Sepolia is taking long")).toBeInTheDocument();
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

it("test votes link to Sepolia's Blockscout, the real vote to Ethereum's", () => {
  expect(explorerTx(HASH)).toBe(`https://eth-sepolia.blockscout.com/tx/${HASH}`);
  expect(explorerTx(HASH, "Ethereum")).toBe(`https://eth.blockscout.com/tx/${HASH}`);
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

it("just counted, its Counted stamp presses down; one already counting on a fresh page doesn't", () => {
  const stamp = () =>
    screen.getAllByText("Counted").find((el) => el.tagName === "SPAN") as HTMLElement;
  panel({ kind: "counted", hash: HASH }, { upToDate: true });
  expect(stamp()).toHaveClass("animate-stamp-press");
  cleanup();
  panel({ kind: "idle" }, { upToDate: true });
  expect(stamp()).not.toHaveClass("animate-stamp-press");
});

it("a recorded transaction waits for replay even when an earlier identical ballot counts", () => {
  const p = panel({ kind: "recorded", hash: HASH }, { upToDate: true });
  expect(screen.getByText("Recorded on Sepolia")).toBeInTheDocument();
  expect(screen.queryByText("Your ballot counts")).not.toBeInTheDocument();
  expect(p.button("Awaiting tally…")).toBeDisabled();
});

it("a replay rejection sends the current edited draft as a new revision instead of retrying the old transaction", () => {
  const p = panel({ kind: "rejected", hash: HASH, reason: "rejected" }, { canSend: true });
  expect(screen.getByText("The tally did not accept this revision")).toBeInTheDocument();
  fireEvent.click(p.button("Send my ballot"));
  expect(p.onSend).toHaveBeenCalledOnce();
  expect(p.onRetry).not.toHaveBeenCalled();
});
