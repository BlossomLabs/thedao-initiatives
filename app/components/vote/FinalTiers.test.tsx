import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FinalTiers from "./FinalTiers";
import VoteClosed from "./VoteClosed";
import { NO_ROUND } from "../../../shared/vote/manifest";
import type { Tier } from "../../../shared/vote/ballot";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
afterEach(cleanup);

const items = ["alpha", "beta", "gamma"].map((slug) => ({ slug, title: slug.toUpperCase() }));

it.each([
  { placed: ["alpha", "beta", "gamma"], withdrawn: [], asked: 1_026_100, total: 1_026_100 },
  { placed: ["alpha"], withdrawn: [], asked: 600_000, total: 1_026_100 },
  { placed: ["alpha", "gamma"], withdrawn: ["beta"], asked: 726_100, total: 726_100 },
])(
  "the sent ballot ring measures $asked of $total in available asks",
  ({ placed, withdrawn, asked, total }) => {
    const asks = [600_000, 300_000, 126_100].map((n) => String(BigInt(n) * 1_000_000n));
    const round = {
      ...NO_ROUND,
      slugs: items.map((i) => i.slug),
      projects: asks.map((goalUsd) => ({ goalUsd, rfp: true, groups: [] })),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <VoteClosed
            n={17}
            round={round}
            titles={new Map(items.map((i) => [i.slug, i.title]))}
            closeText="Nov 1, 14:00"
            items={items}
            sent={Object.fromEntries(placed.map((s) => [s, "S" as Tier]))}
            poolUsd={724_876}
            withdrawn={new Set(withdrawn)}
            live={{ onEdit: () => {}, asks }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const ring = screen.getByRole("meter", { name: "What your ballot asks for" });
    expect(ring).toHaveAttribute("aria-valuenow", String(asked));
    expect(ring).toHaveAttribute("aria-valuemax", String(total));
    expect(Number(ring.querySelector<SVGCircleElement>("circle.stroke-dao-green")!.dataset.to))
      .toBeCloseTo(asked / total);
    expect(ring.querySelector("[stroke-dasharray='2 2']")).toBeNull();
  },
);

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

it("on a badge's ballot, a winner the other ballots paid for says $0, not nothing", () => {
  render(
    <FinalTiers
      label="Your ballot"
      items={items}
      tiers={{ alpha: "S", gamma: "B" }}
      funded={new Set(["alpha", "gamma"])}
      amounts={new Map([["alpha", 9800]])}
      amountWord="your share paid"
      showZero
    />,
  );
  expect(screen.getByLabelText("GAMMA, funded: your share paid $0")).toHaveTextContent("$0");
});

it("after the close: this badge's ballot and TheDAO's result, side by side, the same table", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteClosed
          round={{
            ...NO_ROUND,
            slugs: items.map((i) => i.slug),
            projects: items.map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
          }}
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
  expect(screen.getByText("$420,000 of the $1,000,000 demo pool · 2 initiatives"))
    .toBeInTheDocument();
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
          round={{
            ...NO_ROUND,
            slugs: items.map((i) => i.slug),
            projects: items.map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
          }}
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

describe("a donation's preview", () => {
  it("marks what comes in with the donation and strikes what drops out", () => {
    render(
      <FinalTiers
        label="TheDAO's ballot"
        items={[{ slug: "a", title: "Alpha" }, { slug: "b", title: "Beta" }]}
        tiers={{ a: "S", b: "S" }}
        funded={new Set(["b"])}
        amounts={new Map([["b", 40_000]])}
        amountWord="awarded"
        provisional={new Set(["b"])}
        joining={new Map([["a", 8412]])}
        leaving={new Set(["b"])}
      />,
    );
    expect(screen.getByLabelText("Alpha, comes in if you give $8,412")).toHaveTextContent(
      "+$8,412 if you give",
    );
    // What drops out says so in place of its amount, which no longer counts in its tier's.
    expect(screen.getByLabelText("Beta, drops out")).toHaveTextContent("dropped out");
    expect(screen.queryByText("$40,000")).toBeNull();
  });
  it("what the visitor gave is solid green, '+$X yours'; a typed amount stays dashed", () => {
    render(
      <FinalTiers
        items={[
          { slug: "a", title: "Alpha" },
          { slug: "b", title: "Beta" },
        ] as never}
        tiers={{ a: "S", b: "S" }}
        funded={new Set(["a", "b"])}
        amounts={new Map()}
        amountWord="awarded"
        provisional={new Set(["a", "b"])}
        label="TheDAO's ballot"
        joining={new Map([["b", 3000]])}
        yours={new Map([["a", 9000], ["b", 1000]])}
      />,
    );
    const a = screen.getByLabelText("Alpha, funded if it ended now, $9,000 of it yours");
    expect(a).toHaveTextContent("+$9,000 yours");
    expect(a.className).not.toContain("border-dashed");
    const b = screen.getByLabelText("Beta, comes in if you give $3,000");
    expect(b).toHaveTextContent("+$3,000 if you give");
    expect(b.className).toContain("border-dashed");
  });

  it("lists, in a tier, those that stay, then yours, those moved in, and those dropping out", () => {
    render(
      <FinalTiers
        label="TheDAO's ballot"
        items={["a", "b", "c", "d", "e"].map((slug) => ({ slug, title: slug.toUpperCase() }))}
        tiers={{ a: "B", b: "B", c: "B", d: "B", e: "B" }}
        funded={new Set(["a", "b", "d", "e"])}
        amounts={new Map()}
        amountWord="awarded"
        joining={new Map([["c", 3000]])}
        leaving={new Set(["a", "d"])}
        moved={new Map([["b", "A"]])}
      />,
    );
    const order = [...document.querySelectorAll("[data-final-chip]")].map((el) =>
      el.getAttribute("data-final-chip")
    );
    expect(order).toEqual(["e", "c", "b", "a", "d"]);
  });

  it("shows what the donation moves to another tier, with where it came from", () => {
    render(
      <FinalTiers
        label="TheDAO's ballot"
        items={[{ slug: "a", title: "Alpha" }, { slug: "b", title: "Beta" }]}
        tiers={{ a: "A", b: "B" }}
        funded={new Set(["a", "b"])}
        amounts={new Map([["a", 10_000], ["b", 20_000]])}
        amountWord="awarded"
        provisional={new Set(["a", "b"])}
        moved={new Map([["a", "S"], ["b", "A"]])}
      />,
    );
    expect(screen.getByLabelText("Alpha, moves down from S-Tier")).toHaveTextContent(
      "↓Alphafrom S-Tier",
    );
    expect(screen.getByLabelText("Beta, moves down from A-Tier")).toHaveTextContent(
      "from A-Tier",
    );
  });
});

it("your ballot marks a withdrawn initiative that wasn't funded; a funded one stays funded", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteClosed
          round={{
            ...NO_ROUND,
            slugs: items.map((i) => i.slug),
            projects: items.map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
          }}
          n={17}
          titles={new Map(items.map((i) => [i.slug, i.title]))}
          closeText="Friday"
          items={items}
          sent={{ alpha: "S", beta: "A" }}
          settled={[
            { tier: "S", funded: ["alpha"], awards: { alpha: 300_000 } },
            { tier: "A", funded: [], awards: {} },
            { tier: "B", funded: [], awards: {} },
          ]}
          paid={new Map([["alpha", 9800]])}
          shareUsd={25000}
          poolUsd={1_000_000}
          withdrawn={new Set(["alpha", "beta"])}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const mine = screen.getByRole("group", { name: "Your ballot" });
  expect(within(mine).getByLabelText("BETA, withdrawn")).toHaveTextContent("Withdrawn");
  expect(within(mine).getByLabelText("ALPHA, funded: your share paid $9,800")).toBeInTheDocument();
});

describe("a tier settling while the vote results are open", () => {
  const props = {
    label: "TheDAO's ballot",
    items,
    tiers: { alpha: "S", beta: "S", gamma: "A" } as const,
    funded: new Set(["alpha", "beta", "gamma"]),
    amounts: new Map([["alpha", 9800], ["beta", 5000], ["gamma", 1200]]),
    amountWord: "awarded",
    celebrate: true,
  };
  const chip = (slug: string) =>
    document.querySelector(`[data-final-chip="${slug}"]`) as HTMLElement;

  it("what it funds turns gold and glows, one after another; its row flashes gold", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <FinalTiers {...props} provisional={new Set(["alpha", "beta", "gamma"])} />,
      );
      // On the first render, nothing glows.
      expect(document.querySelector("[data-gold-new]")).toBeNull();
      // S-Tier settles: ALPHA and BETA are gold now; GAMMA is still the live tally's.
      rerender(<FinalTiers {...props} provisional={new Set(["gamma"])} />);
      expect(chip("alpha")).toHaveAttribute("data-gold");
      expect(chip("alpha")).toHaveClass("animate-gold-glow");
      expect(chip("beta")).toHaveClass("animate-gold-glow");
      expect(chip("beta").style.animationDelay).toBe("140ms");
      expect(chip("gamma")).not.toHaveClass("animate-gold-glow");
      const s = screen.getByRole("region", { name: "S · Must fund" });
      expect(s.querySelector("[data-tier-gold]")).not.toBeNull();
      expect(
        screen.getByRole("region", { name: "A · Should fund" }).querySelector(
          "[data-tier-gold]",
        ),
      ).toBeNull();
      // The glow is over: still gold, no longer glowing.
      act(() => vi.advanceTimersByTime(5000));
      expect(chip("alpha")).toHaveAttribute("data-gold");
      expect(chip("alpha")).not.toHaveClass("animate-gold-glow");
      expect(s.querySelector("[data-tier-gold]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a chip already gold when the page opens doesn't glow, nor anything without celebrate", () => {
    const { rerender } = render(<FinalTiers {...props} provisional={new Set(["gamma"])} />);
    rerender(<FinalTiers {...props} provisional={new Set(["gamma"])} />);
    expect(document.querySelector("[data-gold-new]")).toBeNull();
    cleanup();
    const quiet = render(
      <FinalTiers {...props} celebrate={false} provisional={new Set(["alpha"])} />,
    );
    quiet.rerender(<FinalTiers {...props} celebrate={false} provisional={new Set()} />);
    expect(document.querySelector("[data-gold-new]")).toBeNull();
  });
});

describe("the live tally's moves", () => {
  // jsdom lays nothing out: a chip is 100px down per tier and 50px along per place in it.
  const at = (el: Element) => {
    const li = el.closest("li");
    const section = el.closest("section");
    if (!li || !section) return { left: 0, top: 0 };
    return {
      left: [...li.parentElement!.children].indexOf(li) * 50,
      top: [...section.parentElement!.children].indexOf(section) * 100,
    };
  };
  const props = {
    label: "TheDAO's ballot",
    items,
    funded: new Set(["alpha", "beta", "gamma"]),
    amounts: new Map([["alpha", 9800], ["beta", 5000], ["gamma", 1200]]),
    amountWord: "awarded",
  };
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  beforeEach(() => {
    animate.mockClear();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return at(this) as DOMRect;
      },
    );
    Object.defineProperty(HTMLElement.prototype, "animate", {
      value: animate,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });
  const calls = (slug: string) =>
    (animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][]).filter((_, n) =>
      (animate.mock.contexts[n] as HTMLElement).dataset.finalChip === slug
    );

  it("a chip that changes tier moves there from where it was, lifted; one new pops in", () => {
    const { rerender } = render(
      <FinalTiers {...props} tiers={{ alpha: "S", beta: "A" }} moves />,
    );
    expect(animate).not.toHaveBeenCalled();
    rerender(<FinalTiers {...props} tiers={{ alpha: "S", beta: "S", gamma: "B" }} moves />);
    // BETA was at A-Tier's first place, 100px lower: it starts there and comes up.
    const [[keys, opts], [lift]] = calls("beta");
    expect(keys).toEqual([{ translate: "-50px 100px" }, { translate: "0 0" }]);
    expect(opts.duration).toBe(900);
    expect(lift[1]).toMatchObject({ scale: 1.08 });
    // ALPHA stayed put; GAMMA wasn't in the table.
    expect(calls("alpha")).toHaveLength(0);
    expect(calls("gamma")[0][0]).toEqual([{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }]);
    // No marks: no arrows, no tier names on the chips.
    expect(screen.getByLabelText(/^BETA/)).not.toHaveTextContent(/↑|from|Tier/);
  });

  it("a donation's preview (moves off) stays still, on and off, after the live tally", () => {
    const { rerender } = render(<FinalTiers {...props} tiers={{ beta: "A" }} moves />);
    rerender(<FinalTiers {...props} tiers={{ beta: "S" }} moves={false} />);
    rerender(<FinalTiers {...props} tiers={{ beta: "A" }} moves />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("nothing moves without `moves`, nor for a change made while it was off", () => {
    const { rerender } = render(<FinalTiers {...props} tiers={{ beta: "A" }} />);
    rerender(<FinalTiers {...props} tiers={{ beta: "S" }} />);
    rerender(<FinalTiers {...props} tiers={{ beta: "B" }} moves />);
    expect(animate).not.toHaveBeenCalled();
  });
});
