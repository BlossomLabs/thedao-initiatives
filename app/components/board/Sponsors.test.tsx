import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Sponsors from "./Sponsors";
import type { Sponsor } from "~/lib/api-types";

const sponsor = (company: string, totalUsd: number, url = ""): Sponsor => ({
  company,
  logoUrl: "",
  url,
  totalUsd,
});

it("renders nothing until someone has pledged", () => {
  expect(render(<Sponsors sponsors={[]} />).container.innerHTML).toBe("");
  expect(render(<Sponsors sponsors={undefined} />).container.innerHTML).toBe("");
});

it("holds the place with a skeleton while the board loads", () => {
  const { container } = render(<Sponsors loading />);
  expect(screen.getByText("Top sponsors of security for Ethereum")).toBeTruthy();
  expect(container.querySelector("[aria-busy]")?.childElementCount).toBe(1);
  // as tall as the panel this device last drew, else as a stacked row
  expect(container.querySelector("[aria-busy] > *")?.className).toContain(
    "h-[var(--sponsors-h,200px)]",
  );
  expect(screen.queryByRole("list")).toBeNull();
});

it("up to five side by side at full width, stacked in the swiped row below it", () => {
  render(<Sponsors sponsors={["A", "B", "C"].map((c) => sponsor(c, 5000))} />);
  const first = screen.getAllByRole("listitem")[0];
  expect(first).toHaveClass("flex-col", "min-[1100px]:flex-row", "min-[1100px]:w-auto");
  expect(within(first).getByText("pledged")).toHaveClass("hidden", "min-[1100px]:inline");
  expect(within(first).getByText("pledged by")).toHaveClass("block", "min-[1100px]:hidden");
  expect(screen.getByRole("list")).toHaveClass("overflow-x-auto", "min-[1100px]:grid");
});

it('six to eight fill the full width stacked, "pledged by" under the amount', () => {
  render(<Sponsors sponsors={["A", "B", "C", "D", "E", "F"].map((c) => sponsor(c, 5000))} />);
  const first = screen.getAllByRole("listitem")[0];
  expect(first).not.toHaveClass("min-[1100px]:flex-row");
  expect(first).toHaveClass("min-[1100px]:w-auto");
  expect(within(first).getByText("pledged")).not.toHaveClass("min-[1100px]:inline");
  expect(within(first).getByText("pledged by")).not.toHaveClass("min-[1100px]:hidden");
  expect(screen.getByRole("list")).toHaveClass("min-[1100px]:grid");
});

it("more than eight: every one listed, at a fixed width, scrolled through at every width", () => {
  const many = "ABCDEFGHIJKL".split("").map((c, i) => sponsor(c, 9000 - i));
  render(<Sponsors sponsors={many} />);
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(12);
  expect(items[11]).toHaveClass("w-32", "snap-start");
  expect(items[11]).not.toHaveClass("min-[1100px]:w-auto");
  const list = screen.getByRole("list", { name: "Top sponsors of security for Ethereum" });
  expect(list).toHaveClass("overflow-x-auto", "snap-x");
  expect(list).not.toHaveClass("min-[1100px]:grid");
});

it("fades the edges that have more and takes keyboard focus only while it scrolls", () => {
  const many = "ABCDEFGHIJKL".split("").map((c, i) => sponsor(c, 9000 - i));
  const sizes = { clientWidth: 400, scrollWidth: 1536 };
  for (const [k, v] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  }
  try {
    render(<Sponsors sponsors={many} />);
    const list = screen.getByRole("list");
    expect(list.tabIndex).toBe(0);
    // no scrollbar: the arrows, the fade and the hint say there is more
    expect(list).toHaveClass("[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden");
    // how far each edge's fade and arrow have come in, 0 to 1: [left, right]
    const edges = () =>
      ["--edge-l", "--edge-r"].map((v) =>
        Number(list.parentElement!.parentElement!.style.getPropertyValue(v))
      );
    expect(list.style.maskImage).toContain("var(--edge-l, 0)");
    // an arrow on each edge that has more, and none on an end
    const arrows = () => screen.queryAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(edges()).toEqual([0, 1]);
    expect(arrows()).toEqual(["More sponsors"]);
    // the hint under the panel goes with the right arrow, and does what it does
    const hint = screen.getByText("Scroll sideways for more");
    expect(hint.style.opacity).toBe("var(--edge-r, 0)");
    const forward = vi.fn();
    list.scrollBy = forward as never;
    fireEvent.click(hint);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ left: 400 - 128 }));
    // they come in over the first 64px scrolled from an end, not all at once
    list.scrollLeft = 32;
    fireEvent.scroll(list);
    expect(edges()).toEqual([0.5, 1]);
    expect(arrows()).toEqual(["Previous sponsors", "More sponsors"]);
    expect(screen.getByRole("button", { name: "Previous sponsors" }).style.opacity).toBe(
      "var(--edge-l, 0)",
    );
    list.scrollLeft = 300;
    fireEvent.scroll(list);
    expect(edges()).toEqual([1, 1]);
    list.scrollLeft = 1136 - 16;
    fireEvent.scroll(list);
    expect(edges()).toEqual([1, 0.25]);
    list.scrollLeft = 1136;
    fireEvent.scroll(list);
    expect(edges()).toEqual([1, 0]);
    expect(arrows()).toEqual(["Previous sponsors"]);
    expect(hint).toBeDisabled();
    // a page back, less one entry so the last one seen stays in view
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy as never;
    fireEvent.click(screen.getByRole("button", { name: "Previous sponsors" }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -(400 - 128) }));
  } finally {
    for (const k of Object.keys(sizes)) delete (HTMLElement.prototype as never)[k];
  }
});

it("a row that fits neither fades nor takes focus", () => {
  render(<Sponsors sponsors={[sponsor("A", 5000)]} />);
  const list = screen.getByRole("list");
  expect(list.hasAttribute("tabindex")).toBe(false);
  expect(list.style.maskImage).toBe("");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText("Scroll sideways for more")).toBeNull();
});

it("lists the sponsors in order in one row with whole-dollar totals", () => {
  render(
    <Sponsors
      sponsors={[
        sponsor("Argot Collective", 151000.4, "https://argot.org"),
        sponsor("Acme", 800.5),
      ]}
    />,
  );
  expect(screen.getByText("Top sponsors of security for Ethereum")).toBeTruthy();
  const items = screen.getAllByRole("listitem");
  // both captions are in the markup; the width decides which one shows
  expect(items.map((li) => li.textContent)).toEqual([
    "Argot Collective$151,000 pledgedpledged by",
    "Acme$801 pledgedpledged by",
  ]);
  expect(items[0].parentElement).toBe(screen.getByRole("list"));
  expect(screen.getByRole("link", { name: "Argot Collective" }).getAttribute("href")).toBe(
    "https://argot.org",
  );
});
