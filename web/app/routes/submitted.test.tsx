import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Submitted, { type SubmittedState } from "./submitted";

const show = (state: SubmittedState | null) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/submit/thanks", state }]}>
      <Submitted />
    </MemoryRouter>,
  );

describe("Submitted", () => {
  it("names the initiative, the panel and the kind's process, and links to the pending page", () => {
    show({
      title: "My initiative",
      slug: "my-initiative",
      kind: "rfp",
      warnings: [{ field: "ms_0_c0", msg: "x" }, { field: "backers", msg: "y" }],
    });
    expect(screen.getByRole("heading", { name: "Thank you" })).toBeInTheDocument();
    expect(screen.getByText("My initiative")).toBeInTheDocument();
    expect(screen.getByText(/The site adds the "How RFPs work" panel under your text/))
      .toBeInTheDocument();
    expect(screen.getByText(/30-day proposal window/)).toBeInTheDocument();
    expect(screen.getByText("You submitted past 2 warnings. The reviewer sees the same list."))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your initiative (pending review)" }))
      .toHaveAttribute("href", "/initiative/my-initiative");
    expect(screen.getByRole("link", { name: "Back to the board" })).toHaveAttribute("href", "/");
  });

  it("uses the top-up copy and the singular warning", () => {
    show({ title: "T", slug: "t", kind: "topup", warnings: [{ field: "", msg: "x" }] });
    expect(screen.getByText(/How top-up grants work/)).toBeInTheDocument();
    expect(screen.getByText(/no proposal window and no challenge period/)).toBeInTheDocument();
    expect(screen.getByText(/past 1 warning\./)).toBeInTheDocument();
  });

  it("falls back to generic copy without state", () => {
    show(null);
    expect(screen.getByText(/Your initiative/)).toBeInTheDocument();
    expect(screen.queryByText(/The site adds the/)).toBeNull();
    expect(screen.queryByRole("link", { name: /See your initiative/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the board" })).toBeInTheDocument();
  });
});
