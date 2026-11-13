import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RoundTier, RoundView } from "~/hooks/use-vote";
import RoundBox, { badgeLine, length, windowSegments } from "./RoundBox";
import { roundSteps } from "./round-steps";

afterEach(cleanup);

const H = 3600;
const now = Math.floor(Date.now() / 1000);
// Tier-S started 30h ago: window 1 (24h) is over, window 2 (12h) ends in 6h.
const T = now - 30 * H;
const schedule = {
  opensAt: T - 72 * H,
  firstTallyAt: [T, T + 48 * H, T + 96 * H] as [number, number, number],
  initialWindow: 24 * H,
  maxWindows: 4,
};
const waiting = (tier: "S" | "A" | "B", startsAt: number): RoundTier => ({
  tier,
  status: "waiting",
  startsAt,
});
const view = (tiers: RoundTier[]): RoundView => ({
  registrationClosesAt: T + 45 * H,
  closed: false,
  tiers,
  accepted: {},
  rejected: [],
  live: { funded: [], awards: {} },
});
const settlingS = (quiet: boolean): RoundTier => ({
  tier: "S",
  status: "settling",
  window: 2,
  windowEndsAt: T + 36 * H,
  latestEndAt: T + 45 * H,
  quiet,
  funded: [],
});
const later = [waiting("A", T + 48 * H), waiting("B", T + 96 * H)];

describe("RoundBox", () => {
  it("bare, on the ballot editor: a light green box, the countdown says what it counts to", () => {
    render(
      <RoundBox
        schedule={schedule}
        rv={view([settlingS(true), ...later])}
        badge={{ tone: "ok", text: "Your ballot counts." }}
        bare
      />,
    );
    const box = screen.getByRole("region", { name: "Where the round is" });
    expect(box).toHaveClass("bg-dao-green/[.09]");
    expect(within(box).getByRole("heading", { name: "Tier-S is settling" })).toBeInTheDocument();
    expect(box).toHaveTextContent(/This window ends at \d{2}:\d{2}\s*in (5h 59m|6h 00m)/);
    expect(within(box).getAllByRole("listitem")).toHaveLength(5);
    expect(box.querySelectorAll("[data-window]")).toHaveLength(4);
    expect(within(box).getByRole("status")).toHaveTextContent("Your ballot counts.");
  });

  it("a settling tier: the stepper on it, its countdown, and a bar of its windows", () => {
    render(<RoundBox schedule={schedule} rv={view([settlingS(true), ...later])} />);
    const box = screen.getByRole("region", { name: "Where the round is" });
    expect(within(box).getByRole("heading", { name: "Tier-S is settling" })).toBeInTheDocument();
    expect(within(box).getByRole("timer")).toHaveTextContent(/^in 5h 59m|^in 6h 00m/);
    const steps = within(box).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("aria-current"))).toEqual([
      null,
      "step",
      null,
      null,
      null,
    ]);
    expect([...box.querySelectorAll("[data-window]")].map((b) => b.getAttribute("data-window")))
      .toEqual(["past", "current", "maybe", "maybe"]);
    expect(box).toHaveTextContent(/If nothing changes, Tier-S settles at \d{2}:\d{2}\./);
  });

  it("each window has its own popup: its length, times and what it means", async () => {
    render(<RoundBox schedule={schedule} rv={view([settlingS(false), ...later])} />);
    const coming = screen.getByRole("button", { name: /Tier-S Window 3 · 6h, will follow/ });
    fireEvent.click(coming);
    const pop = await screen.findByText("Will run: Tier-S changed in window 2.");
    const card = pop.closest("[data-window-popup]")!;
    expect(card).toHaveTextContent("Window 3 · 6h");
    expect(card).toHaveTextContent("will follow");
    expect(card).toHaveTextContent("→");
    // Only one open; a tap elsewhere closes it.
    expect(document.querySelectorAll("[data-window-popup]")).toHaveLength(1);
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByText("Will run: Tier-S changed in window 2.")).toBeNull()
    );
    fireEvent.click(screen.getByRole("button", { name: /Window 1 · 24h, done/ }));
    expect(await screen.findByText("Tier-S changed in it, so window 2 followed."))
      .toBeInTheDocument();
  });

  it("the real schedule's short windows (4 to 9) are one block, with every window in its popup", async () => {
    // 9 windows from 24h, Tier-S in window 5 (1h 30m), which has changed.
    const real = { ...schedule, maxWindows: 9 };
    const w5 = T + (24 + 12 + 6 + 3) * H;
    const s5: RoundTier = {
      tier: "S",
      status: "settling",
      window: 5,
      windowEndsAt: w5 + 1.5 * H,
      latestEndAt: T + 48 * H - 338,
      quiet: false,
      funded: [],
    };
    render(<RoundBox schedule={real} rv={view([s5, ...later])} />);
    const box = screen.getByRole("region", { name: "Where the round is" });
    expect([...box.querySelectorAll("[data-window]")].map((b) => b.getAttribute("data-window")))
      .toEqual(["past", "past", "past", "current"]);
    expect(box).toHaveTextContent(/3h…5m/);
    // In the block, the window running now (and the one to follow) keep a visible width,
    // however short: the green mark that moves along the bar.
    const fills = box.querySelectorAll('[data-window="current"] > span:first-child > span');
    expect([...fills].map((f) => f.className.includes("min-w-2"))).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: /Tier-S Windows 4–9, now: window 5/ }),
    );
    const pop = (await screen.findByText(/Windows 4–9/)).closest("[data-window-popup]")!;
    const rows = [...pop.querySelectorAll("[data-window-row]")];
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.getAttribute("data-window-row")).slice(0, 4))
      .toEqual(["past", "current", "coming", "maybe"]);
    expect(rows[1]).toHaveTextContent("1h 30m");
    expect(rows[5]).toHaveTextContent(/^Window 9\s*5m 37s\s*ends \d{2}:\d{2}$/);
    expect(pop).toHaveTextContent("Tier-S changed in it, so window 6 will follow.");
  });

  it("window lengths read in at most two units; a short schedule keeps every window alone", () => {
    expect([86400, 5400, 1350, 42, 1].map(length)).toEqual([
      "24h",
      "1h 30m",
      "22m 30s",
      "42s",
      "1s",
    ]);
    expect(windowSegments(4)).toHaveLength(4);
    expect(windowSegments(9).at(-1)).toEqual({ first: 3, last: 8 });
  });

  it("between tiers, on the ballot: what settled, what was this ballot's, and the badge line", () => {
    render(
      <RoundBox
        schedule={schedule}
        rv={view([
          {
            tier: "S",
            status: "settled",
            at: T + 24 * H,
            forced: false,
            funded: ["a", "b", "c", "d"],
            awards: { a: "300000000000", b: "220000000000" },
          },
          ...later,
        ])}
        mine={{ onBallot: 2, paidUsd: 9800, shareUsd: 25000 }}
        badge={{
          tone: "ok",
          text: "Tier-S is locked. Tier-A and Tier-B are still yours to change.",
        }}
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Tier-S settled: 4 initiatives, $520k");
    expect(screen.getByText(/^Tier-A starts settling/)).toBeInTheDocument();
    expect(
      screen.getByText("2 of the 4 were on your ballot. You paid $9,800 of your $25,000 share."),
    )
      .toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Tier-S is locked.");
  });

  it("without a badge line (the results page) there is no status about a badge", () => {
    render(<RoundBox schedule={schedule} rv={view([settlingS(true), ...later])} large />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("badgeLine", () => {
  const phase = (tiers: RoundTier[]) => roundSteps({ schedule, tiers, now }).phase;
  it("a badge that hasn't voted: still time while Tier-S settles", () => {
    expect(badgeLine({ phase: phase([settlingS(true), ...later]), counted: false, settled: [] }))
      .toEqual({
        tone: "todo",
        text:
          "This badge hasn’t voted yet. There is still time: send a first ballot before Tier-S settles.",
      });
  });
  it("after Tier-S settled, a badge that never voted is out", () => {
    expect(
      badgeLine({ phase: phase([settlingS(true), ...later]), counted: false, settled: ["S"] }).tone,
    ).toBe("muted");
  });
  it("a counted badge: what's locked and what's still open", () => {
    expect(
      badgeLine({ phase: phase([settlingS(true), ...later]), counted: true, settled: [] }).text,
    )
      .toBe("Your ballot counts. You can still change every tier.");
    expect(
      badgeLine({ phase: phase([settlingS(true), ...later]), counted: true, settled: ["S", "A"] })
        .text,
    ).toBe("Tier-S and Tier-A are locked. Tier-B is still yours to change.");
  });
});

describe("RoundBox, steps only", () => {
  it("a title, the stepper and the badge line, without the tier's windows", () => {
    render(
      <RoundBox
        schedule={schedule}
        rv={view([settlingS(true), ...later])}
        badge={{ tone: "ok", text: "Your ballot counts." }}
        stepsOnly
      />,
    );
    const where = screen.getByRole("region", { name: "Where the round is" });
    expect(within(where).getAllByRole("listitem")).toHaveLength(5);
    expect(within(where).getByRole("status")).toHaveTextContent("Your ballot counts.");
    // Its title says where the round is; the windows aren't there.
    expect(within(where).getByRole("heading", { name: "Tier-S is settling" })).toBeInTheDocument();
    expect(where.querySelector("[data-window]")).toBeNull();
  });
});
