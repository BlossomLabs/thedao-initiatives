import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PledgeBand from "./PledgeBand";

const open = vi.hoisted(() => vi.fn());
vi.mock("~/lib/support", () => ({ openPledgeRequest: open }));

it("offers one way to pledge: the form, with no initiative chosen yet", () => {
  render(<PledgeBand />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pledge to an initiative" }));
  expect(open).toHaveBeenCalledWith();
});
