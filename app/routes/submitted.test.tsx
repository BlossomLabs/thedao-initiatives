import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { confettiBurst } from "~/components/donate/Celebration";
import Submitted, { type SubmittedState } from "./submitted";

vi.mock("~/components/donate/Celebration", () => ({ confettiBurst: vi.fn() }));

const show = (state: SubmittedState | null) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/submit/thanks", state }]}>
      <Submitted />
    </MemoryRouter>,
  );

describe("Submitted", () => {
  beforeEach(() => vi.mocked(confettiBurst).mockClear());

  it("celebrates, names the initiative and links to the pending page", () => {
    show({
      title: "My initiative",
      slug: "my-initiative",
      warnings: [{ field: "ms_0_c0", msg: "x" }, { field: "backers", msg: "y" }],
    });
    expect(screen.getByRole("heading", { name: "Congratulations" })).toBeInTheDocument();
    expect(screen.getByText("Thank you")).toBeInTheDocument();
    expect(confettiBurst).toHaveBeenCalledTimes(1);
    expect(screen.getByText("My initiative")).toBeInTheDocument();
    expect(screen.getByText("You submitted past 2 warnings. The reviewer sees the same list."))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your initiative (pending review)" }))
      .toHaveAttribute("href", "/initiative/my-initiative");
    expect(screen.getByRole("link", { name: "Back to the board" })).toHaveAttribute("href", "/");
  });

  it("uses the singular warning", () => {
    show({ title: "T", slug: "t", warnings: [{ field: "", msg: "x" }] });
    expect(screen.getByText(/past 1 warning\./)).toBeInTheDocument();
  });

  it("falls back to generic copy without state", () => {
    show(null);
    expect(screen.getByText(/Your initiative/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See your initiative/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the board" })).toBeInTheDocument();
    expect(confettiBurst).not.toHaveBeenCalled();
  });
});
