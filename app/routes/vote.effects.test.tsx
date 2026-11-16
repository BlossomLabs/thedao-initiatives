import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { confettiBurst } from "~/components/donate/Celebration";
import { RowFigure } from "~/components/vote/GiveList";
import VoteEffects from "./vote.effects";

vi.mock("~/components/donate/Celebration", () => ({ confettiBurst: vi.fn() }));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
// The hero's count-up waits to be on screen.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }]);
    }
    unobserve() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteEffects />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const card = (name: string) => within(screen.getByRole("region", { name }));

it("a green figure updates directly to the checked amount without counting through unchecked amounts", () => {
  const frame = vi.spyOn(globalThis, "requestAnimationFrame");
  try {
    const { rerender, container } = render(
      <RowFigure kind="threat" usd={12_340} name="S-Tier" />,
    );
    expect(container).toHaveTextContent("$12,340ahead");
    rerender(<RowFigure kind="threat" usd={37_890} name="S-Tier" />);
    expect(container).toHaveTextContent("$37,890ahead");
    expect(frame).not.toHaveBeenCalled();
    rerender(<RowFigure kind="threat" usd={null} name="S-Tier" />);
    expect(container.querySelector("[data-figure]")).toHaveTextContent(/^$/);
    expect(container.querySelector("b")).toBeNull();
    rerender(<RowFigure kind="threat" usd={undefined} name="S-Tier" />);
    expect(container.querySelector("[data-figure]")).toHaveTextContent(/^$/);
  } finally {
    frame.mockRestore();
  }
});

it("every effect has its card and a button that plays it", () => {
  vi.useFakeTimers();
  show();
  vi.mocked(confettiBurst).mockClear();

  fireEvent.click(card("Donation confirmed").getByRole("button", { name: "Play" }));
  expect(confettiBurst).toHaveBeenLastCalledWith();

  vi.mocked(confettiBurst).mockClear();
  const glow = vi.fn();
  globalThis.addEventListener("thedao:badge-glow", glow);
  const stampIn = () =>
    card("Ballot counted").getAllByText("Counted").find((el) => el.tagName === "SPAN");
  // A ballot that already counts: the stamp, still.
  expect(stampIn()).not.toHaveClass("animate-stamp-press");
  fireEvent.click(card("Ballot counted").getByRole("button", { name: "Play" }));
  expect(stampIn()).toHaveClass("animate-stamp-press");
  // The ballot itself doesn't move.
  expect(
    card("Ballot counted").getByRole("group", { name: /./ }).querySelector(
      ".animate-tier-gold, .animate-tier-land",
    ),
  ).toBeNull();
  expect(glow).toHaveBeenCalledOnce();
  globalThis.removeEventListener("thedao:badge-glow", glow);

  fireEvent.click(card("A tier settles").getByRole("button", { name: "Play" }));
  act(() => vi.advanceTimersByTime(100));
  expect(document.querySelectorAll("[data-gold-new]")).toHaveLength(3);

  fireEvent.click(card("Live tally moves").getByRole("button", { name: "Play" }));
  expect(
    within(card("Live tally moves").getByRole("region", { name: /^S · / })).getByLabelText(
      /^Audit fund/,
    ),
  ).toBeInTheDocument();
  card("Live tally moves").getByRole("button", { name: "Play back" });

  fireEvent.click(card("The vote finishes").getByRole("button", { name: "Play" }));
  expect(screen.getByRole("region", { name: "The vote finishes" }).querySelector("[data-finished]"))
    .not.toBeNull();
  // Gold for the vote: confetti only for the donation above.
  expect(confettiBurst).not.toHaveBeenCalled();

  expect(screen.getByRole("region", { name: "A gap closes" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "TheDAO's ring" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Countdown's last minutes" })).toBeInTheDocument();
});
