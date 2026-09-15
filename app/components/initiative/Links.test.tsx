import { render, screen } from "@testing-library/react";
import Links from "./Links";
import { diffRevisions } from "~/lib/revision-diff";

describe("Links", () => {
  it("links https lines and leaves the rest as text", () => {
    render(
      <Links links={["https://example.org/spec", "http://plain.example", "javascript:alert(1)"]} />,
    );
    expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.org/spec");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("http://plain.example")).toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("renders nothing without links and a diff in changes mode", () => {
    const { container, rerender } = render(<Links links={[]} />);
    expect(container).toBeEmptyDOMElement();
    const base = { title: "", summary: "", details: "", sections: {}, milestones: [] };
    const diff = diffRevisions({ ...base, links: ["https://a.example"] }, {
      ...base,
      links: ["https://a.example", "https://b.example"],
    });
    rerender(<Links links={[]} diff={diff} />);
    expect(container.querySelector(".diff ins")?.textContent).toContain("b.example");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
