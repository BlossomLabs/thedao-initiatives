import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import FinalTiers from "./FinalTiers";
import VoteClosed from "./VoteClosed";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
afterEach(cleanup);

const items = ["alpha", "beta", "gamma"].map((slug) => ({ slug, title: slug.toUpperCase() }));

it("a settled tier table: each tier's amount, funded chips with theirs, the rest dimmed", () => {
  render(
    <FinalTiers
      label="Your ballot"
      items={items}
      tiers={{ alpha: "S", beta: "S", gamma: "B" }}
      funded={new Set(["alpha", "gamma"])}
      amounts={new Map([["alpha", 9800], ["gamma", 1200]])}
      amountWord="your share paid"
      footer="Your badge allocated $11,000 of its $25,000 share."
    />,
  );
  const s = screen.getByRole("region", { name: "S · Must fund" });
  expect(s).toHaveTextContent("$9,800");
  expect(within(s).getByLabelText("ALPHA, funded: your share paid $9,800")).toHaveTextContent(
    "$9,800",
  );
  expect(within(s).getByLabelText("BETA, not funded")).toHaveClass("opacity-55");
  expect(screen.getByRole("region", { name: "A · Should fund" })).toHaveTextContent(
    "Nothing in this tier",
  );
  expect(screen.getByText("Your badge allocated $11,000 of its $25,000 share."))
    .toBeInTheDocument();
});

it("after the close: this badge's ballot and TheDAO's result, side by side, the same table", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteClosed
          n={17}
          titles={new Map(items.map((i) => [i.slug, i.title]))}
          closeText="Friday"
          items={items}
          sent={{ alpha: "S", beta: "A" }}
          settled={[
            { tier: "S", funded: ["alpha"], awards: { alpha: 300_000 } },
            { tier: "A", funded: ["gamma"], awards: { gamma: 120_000 } },
            { tier: "B", funded: [], awards: {} },
          ]}
          paid={new Map([["alpha", 9800]])}
          shareUsd={25000}
          poolUsd={1_000_000}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const mine = screen.getByRole("group", { name: "Your ballot" });
  expect(within(mine).getByLabelText("ALPHA, funded: your share paid $9,800")).toBeInTheDocument();
  expect(within(mine).getByLabelText("BETA, not funded")).toBeInTheDocument();
  // Each card's header: an avatar ringed by what went to what was funded, and the totals.
  expect(screen.getByRole("heading", { level: 2, name: "Your ballot" })).toBeInTheDocument();
  expect(screen.getByText("$9,800 of your $25,000 share")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "What your badge allocated of its share" }))
    .toHaveAttribute("aria-valuenow", "39");

  const result = screen.getByRole("group", { name: "TheDAO's result" });
  // The result's grade boxes sit on the right, out of the arrows' way.
  expect(within(result).getByRole("region", { name: "S · Must fund" })).toHaveClass(
    "flex-row-reverse",
  );
  expect(within(mine).getByRole("region", { name: "S · Must fund" })).not.toHaveClass(
    "flex-row-reverse",
  );
  expect(within(result).getByRole("region", { name: "S · Must fund" })).toHaveTextContent(
    "$300,000",
  );
  // Gold only where it was on this ballot too: ALPHA was, GAMMA wasn't.
  expect(within(result).getByLabelText("ALPHA, funded: awarded $300,000")).toHaveAttribute(
    "data-gold",
  );
  const gamma = within(result).getByLabelText("GAMMA, funded: awarded $120,000");
  expect(gamma).not.toHaveAttribute("data-gold");
  expect(gamma).not.toHaveClass("opacity-55");
  expect(within(result).getByRole("region", { name: "B · Nice to have" })).toHaveTextContent(
    "Nothing in this tier",
  );
  expect(screen.getByRole("heading", { name: "TheDAO's result" })).toBeInTheDocument();
  expect(screen.getByText("$420,000 of the $1,000,000 pool · 2 initiatives")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "What TheDAO allocated of the pool" }))
    .toHaveAttribute("aria-valuenow", "42");
  expect(screen.getByRole("img", { name: "TheDAO" })).toHaveAttribute("src", "/dao-logo.svg");
  // The tables are the result: the way on is to the board, from the result's heading.
  expect(screen.getByRole("link", { name: "See them on the board →" })).toHaveAttribute(
    "href",
    "/vote",
  );
  expect(screen.queryByRole("link", { name: "See the result" })).toBeNull();
});

it("hovering or tapping a winner on the ballot draws its arrow to the result, and only then", () => {
  // jsdom lays nothing out: put the ballot's chips on the left and the result's on the right.
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const side = this.closest(`[aria-label="TheDAO's result"]`)
        ? 600
        : this.closest("[aria-label='Your ballot']")
        ? 100
        : 0;
      const chip = this.hasAttribute("data-final-chip");
      return new DOMRect(chip ? side : 0, chip ? 200 : 0, chip ? 120 : 1200, chip ? 32 : 800);
    },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteClosed
          n={17}
          titles={new Map(items.map((i) => [i.slug, i.title]))}
          closeText="Friday"
          items={items}
          sent={{ alpha: "S", beta: "A" }}
          settled={[
            { tier: "S", funded: ["alpha"], awards: { alpha: 300_000 } },
            { tier: "A", funded: ["gamma"], awards: { gamma: 120_000 } },
          ]}
          paid={new Map([["alpha", 9800]])}
          poolUsd={1_000_000}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const arrow = () => document.querySelector("svg[data-arrow]");
  const mine = screen.getByRole("group", { name: "Your ballot" });
  const alpha = within(mine).getByLabelText(/^ALPHA, funded/);
  // Nothing until asked.
  expect(arrow()).toBeNull();
  fireEvent.pointerEnter(alpha, { pointerType: "mouse" });
  expect(arrow()).toHaveAttribute("data-arrow", "alpha");
  expect(arrow()!.querySelectorAll("g path")).toHaveLength(2);
  expect(alpha).toHaveAttribute("data-active");
  fireEvent.pointerLeave(alpha, { pointerType: "mouse" });
  expect(arrow()).toBeNull();
  // A tap keeps it until a tap elsewhere.
  fireEvent.click(alpha);
  expect(arrow()).toHaveAttribute("data-arrow", "alpha");
  fireEvent.pointerDown(document.body);
  expect(arrow()).toBeNull();
  // From the result's side it points the other way: from the result back to the ballot.
  const theirs = within(screen.getByRole("group", { name: "TheDAO's result" })).getByLabelText(
    /^ALPHA, funded/,
  );
  fireEvent.pointerEnter(theirs, { pointerType: "mouse" });
  expect(arrow()).toHaveAttribute("data-from", "result");
  const d = arrow()!.querySelector("g path")!.getAttribute("d")!;
  // Starts at the result chip's left edge (600 - 4), ends at the ballot chip's right (220 + 4).
  expect(d.startsWith("M 596 216 ")).toBe(true);
  expect(d.endsWith(", 224 216")).toBe(true);
  fireEvent.pointerLeave(theirs, { pointerType: "mouse" });
  fireEvent.pointerEnter(alpha, { pointerType: "mouse" });
  expect(arrow()).toHaveAttribute("data-from", "ballot");
  expect(arrow()!.querySelector("g path")!.getAttribute("d")!.startsWith("M 224 216 ")).toBe(true);
  fireEvent.pointerLeave(alpha, { pointerType: "mouse" });
  // Only winners on this ballot have one: BETA lost, GAMMA wasn't on it.
  expect(within(mine).getByLabelText("BETA, not funded")).not.toHaveAttribute("tabindex");
  const result = screen.getByRole("group", { name: "TheDAO's result" });
  expect(within(result).getByLabelText(/^GAMMA/)).not.toHaveAttribute("tabindex");
  spy.mockRestore();
});
