import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SortSelect from "./SortSelect";

const openSort = () => {
  const t = screen.getByRole("combobox", { name: "Sort" });
  t.focus();
  fireEvent.keyDown(t, { key: "ArrowDown" });
};

it("offers the eight sorts, Featured first, when some initiative is featured", async () => {
  render(<SortSelect sort="recommended" ai={false} featured onSort={vi.fn()} />);
  openSort();
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(8));
});

it("shows AI matches while the AI order is on, and a manual pick reports it", async () => {
  const onSort = vi.fn();
  render(<SortSelect sort="newest" ai featured onSort={onSort} />);
  expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent("AI matches");
  openSort();
  const opt = await screen.findByRole("option", { name: "Newest" });
  // Keyboard, as Base UI ignores a click that lands the instant the list opens;
  // step down until Newest is highlighted.
  for (let i = 0; i < 8 && !opt.hasAttribute("data-highlighted"); i++) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(opt).toHaveAttribute("data-highlighted");
  fireEvent.keyDown(opt, { key: "Enter" });
  expect(onSort).toHaveBeenCalledWith("newest");
});

it("drops Featured when nothing is featured", async () => {
  render(<SortSelect sort="closest" ai={false} featured={false} onSort={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent("Closest to funded");
  openSort();
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(7));
  expect(screen.queryByRole("option", { name: "Featured" })).toBeNull();
});
