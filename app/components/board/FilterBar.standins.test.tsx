/** Before the Selects' code arrives (their own file, so nothing preloaded them):
 * plain buttons with the same faces, which pass focus on to the real controls. */
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FilterBar from "./FilterBar";
import { DEFAULT_VIEW } from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";

const counts = {
  type: { all: 12, rfp: 7, grant: 5 },
  cats: Object.fromEntries(CATEGORIES.map((c, i) => [c.slug, i + 1])),
};

it("stand-ins wear the real controls' faces, then hand focus to them", async () => {
  render(
    <FilterBar
      view={{ ...DEFAULT_VIEW, type: "grant", status: "open", sort: "newest" }}
      onChange={vi.fn()}
      counts={counts}
      shown={3}
      total={12}
      ai={false}
      onSort={vi.fn()}
      sheet={null}
    />,
  );
  const faces = {
    Type: screen.getByRole("button", { name: "Type" }),
    "Funding status": screen.getByRole("button", { name: "Funding status" }),
    Sort: screen.getByRole("button", { name: "Sort" }),
  };
  const before = Object.fromEntries(
    Object.entries(faces).map(([k, el]) => [k, [el.className, el.textContent]]),
  );
  expect(before.Type[1]).toBe("Grants 5");
  expect(before.Sort[1]).toContain("Newest");
  faces.Sort.focus();
  const sort = await waitFor(() => screen.getByRole("combobox", { name: "Sort" }), {
    timeout: 5000,
  });
  await waitFor(() => expect(document.activeElement).toBe(sort));
  for (const name of ["Type", "Funding status"] as const) {
    const real = await waitFor(() => screen.getByRole("combobox", { name }), { timeout: 5000 });
    // Same pill and the same text: the swap does not move or change anything.
    expect([real.className, real.textContent]).toEqual(before[name]);
  }
  expect([sort.className, sort.textContent]).toEqual(before.Sort);
});
