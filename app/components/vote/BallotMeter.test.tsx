import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import BallotMeter from "./BallotMeter";

afterEach(cleanup);

it("before anything settles: the ring is the ask toward 1.5× the pool, and the share is an estimate", () => {
  render(
    <BallotMeter
      avatar={<img alt="" />}
      asked={900_000}
      target={1_500_000}
      pool={1_000_000}
      share={25_000}
      shareFinal={false}
      settled={[]}
    />,
  );
  expect(screen.getByText("$900,000 asked")).toBeInTheDocument();
  expect(screen.getByText("Your share: about $25,000")).toBeInTheDocument();
  const meter = screen.getByRole("meter", { name: "What your ballot asks for" });
  expect(meter).toHaveAttribute("aria-valuenow", "900000");
  expect(meter).toHaveAttribute("aria-valuemax", "1500000");
  expect(screen.getByRole("region", { name: "Your ballot" })).not.toHaveAttribute("title");
});

it("once a tier settles: what it funded from the ballot, and what is left of the share", () => {
  render(
    <BallotMeter
      avatar={<img alt="" />}
      asked={1_700_000}
      target={1_500_000}
      pool={1_000_000}
      share={25_000}
      shareFinal
      settled={[
        {
          tier: "S",
          funded: 2,
          fundedUsd: 220_000,
          paid: 10_500,
          fundedAsk: 240_000,
          waitingAsk: 0,
        },
        { tier: "A", funded: 0, fundedUsd: 0, paid: 0, fundedAsk: 0, waitingAsk: 0 },
      ]}
    />,
  );
  expect(screen.getByText("Tier-S funded 2 · $220,000")).toBeInTheDocument();
  expect(screen.getByText("Tier-A funded nothing from your ballot")).toBeInTheDocument();
  expect(screen.getByText("$14,500 of your $25,000 share left")).toBeInTheDocument();
  // A full ring caps at the target.
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1500000");
});

it("the ring in three: gold funded, dim gold settled but not funded, green still open", () => {
  const { container } = render(
    <BallotMeter
      avatar={<img alt="" />}
      asked={1_200_000}
      target={1_500_000}
      pool={1_000_000}
      share={25_000}
      shareFinal
      settled={[
        {
          tier: "S",
          funded: 1,
          fundedUsd: 250_000,
          paid: 9_000,
          fundedAsk: 300_000,
          waitingAsk: 450_000,
        },
      ]}
    />,
  );
  // End to end from the top: gold, then dim gold, then green.
  const span = (cls: string) => {
    const arc = [...container.querySelectorAll("circle")].find((c) =>
      c.getAttribute("class")?.split(" ").includes(cls)
    )!;
    return [Number(arc.dataset.from), Number(arc.dataset.to)];
  };
  expect(span("stroke-vote")).toEqual([0, 0.2]);
  expect(span("stroke-vote-pale")).toEqual([0.2, 0.5]);
  // The green's solid part stops 12px short: its end is dashed.
  const [from, to] = span("stroke-dao-green");
  expect(from).toBe(0.5);
  expect(to).toBeCloseTo(0.8 - 12 / (2 * Math.PI * 30));
});

const threeParts = () =>
  render(
    <BallotMeter
      avatar={<img alt="" />}
      asked={1_200_000}
      target={1_500_000}
      pool={1_000_000}
      share={25_000}
      shareFinal
      settled={[
        {
          tier: "S",
          funded: 1,
          fundedUsd: 250_000,
          paid: 9_000,
          fundedAsk: 300_000,
          waitingAsk: 450_000,
        },
      ]}
    />,
  );

/** Where each segment of `threeParts` points from the centre, as a turn from the top. */
const TURN: Record<string, number> = { funded: 0.1, waiting: 0.35, open: 0.65, rest: 0.9 };
/** The ring's hover area, and a point on it `turn` of the way round (jsdom lays nothing
 * out: the area's centre is at 0, 0). */
const hit = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-ring-hit]")!;
const toward = (turn: number, r = 20) => ({
  pointerType: "mouse",
  clientX: r * Math.sin(2 * Math.PI * turn),
  clientY: -r * Math.cos(2 * Math.PI * turn),
});
const point = (c: HTMLElement, key: string, r?: number) =>
  fireEvent.pointerMove(hit(c), toward(TURN[key], r));
const tap = (c: HTMLElement, turn: number) => fireEvent.click(hit(c), toward(turn));

/** The open popup: its title, amount and description. */
const popup = () => document.querySelector("[data-ring-popup]")?.textContent ?? null;

it("each segment has its own popup: its dot, title and amount, then what it means", async () => {
  const { container } = threeParts();
  const hover = async (key: string, title: string, rest: string) => {
    point(container, key);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(popup()).toBe(title + rest);
    // Only this one is open.
    expect(document.querySelectorAll("[data-ring-popup]")).toHaveLength(1);
    fireEvent.pointerLeave(hit(container), { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
  };
  await hover("funded", "Funded", "$300,000What the settled tiers funded from your ballot.");
  await hover(
    "waiting",
    "Settled, not funded yet",
    "$450,000Locked in a settled tier. First in line for what you have left.",
  );
  await hover("open", "Open tiers", "$450,000Still yours to change.");
  await hover(
    "rest",
    "Left to fill",
    "$300,000The ring is full at $1,500,000, 1.5× the $1,000,000 pool.",
  );
});

it("a tap on a segment opens its popup too; a tap elsewhere closes it", async () => {
  const { container } = threeParts();
  tap(container, TURN.waiting);
  expect(await screen.findByText("Settled, not funded yet")).toBeInTheDocument();
  expect(screen.queryByText("Funded")).toBeNull();
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByText("Settled, not funded yet")).toBeNull());
});

it("before anything settles the ring has only the ask and what fills it", async () => {
  const { container } = render(
    <BallotMeter
      avatar={<img alt="" />}
      asked={900_000}
      target={1_500_000}
      pool={1_000_000}
      shareFinal={false}
      settled={[]}
    />,
  );
  // $900,000 of $1,500,000: green to 0.6 of the way round, then what is left to fill.
  tap(container, 0.3);
  expect(await screen.findByText("Your ballot", { selector: "b" })).toBeInTheDocument();
  expect(popup()).toBe("Your ballot$900,000What your ballot asks for so far.");
});

it("hovering a segment fades the others back; leaving brings them back", () => {
  const { container } = threeParts();
  const dimmed = () =>
    [...container.querySelectorAll<SVGCircleElement>("circle[data-dim]")].map((c) =>
      c.getAttribute("class")?.split(" ")[0]
    );
  expect(dimmed()).toEqual([]);
  point(container, "waiting");
  expect(dimmed()).toEqual(["stroke-vote", "stroke-dao-green"]);
  fireEvent.pointerLeave(hit(container), { pointerType: "mouse" });
  expect(dimmed()).toEqual([]);
});

it("anywhere in a segment's direction picks it: over the avatar, on the ring, just outside", async () => {
  const { container } = threeParts();
  for (const r of [6, 30, 38]) {
    point(container, "funded", r);
    expect(await screen.findByText("Funded")).toBeInTheDocument();
    point(container, "open", r);
    expect(await screen.findByText("Open tiers")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Funded")).toBeNull());
  }
});

it("the green line ends in dashes, also on a full ring", () => {
  const ring = (asked: number) =>
    render(
      <BallotMeter
        avatar={<img alt="" />}
        asked={asked}
        target={1_500_000}
        pool={1_000_000}
        shareFinal={false}
        settled={[]}
      />,
    ).container;
  const C = 2 * Math.PI * 30;
  const at = (turn: number) =>
    `${(32 + 30 * Math.cos(2 * Math.PI * turn)).toFixed(3)} ${
      (32 + 30 * Math.sin(2 * Math.PI * turn)).toFixed(3)
    }`;
  // $900,000 of $1,500,000: green to 0.6 of the way round, its last 12px dashed.
  let c = ring(900_000);
  let dashes = c.querySelectorAll("[data-dashes]");
  expect(dashes).toHaveLength(1);
  expect(dashes[0].getAttribute("class")).toContain("stroke-dao-green");
  expect(dashes[0].getAttribute("d")).toBe(`M ${at(0.6 - 12 / C)} A 30 30 0 0 1 ${at(0.6)}`);
  expect(dashes[0].getAttribute("stroke-dasharray")).toBe("2 2");
  // The solid green stops where the dashes start.
  const solid = c.querySelector<SVGCircleElement>("circle.stroke-dao-green")!;
  expect(Number(solid.dataset.to)).toBeCloseTo(0.6 - 12 / C);
  cleanup();
  // A full ring keeps them: you can still add.
  c = ring(2_000_000);
  dashes = c.querySelectorAll("[data-dashes]");
  expect(dashes).toHaveLength(1);
  expect(dashes[0].getAttribute("d")!.endsWith(at(1))).toBe(true);
  cleanup();
});

it("with ballot rules, the share gives way to what the ballot still needs", () => {
  const show = (status: { ok: boolean; text: string }) =>
    render(
      <BallotMeter
        avatar={<img alt="" />}
        asked={900_000}
        target={1_500_000}
        pool={1_000_000}
        share={25_000}
        shareFinal={false}
        settled={[]}
        status={status}
      />,
    );
  show({ ok: false, text: "Needs at least $1,500,000 to be valid" });
  expect(screen.getByRole("status")).toHaveTextContent("Needs at least $1,500,000 to be valid");
  expect(screen.getByRole("status")).toHaveClass("text-amber-200");
  expect(screen.queryByText(/Your share/)).toBeNull();
  cleanup();
  show({ ok: true, text: "You can keep adding initiatives" });
  expect(screen.getByRole("status")).toHaveClass("text-dao-green");
});
