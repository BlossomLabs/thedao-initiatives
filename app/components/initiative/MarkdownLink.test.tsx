// deno-lint-ignore-file require-await
// act() takes async callbacks so the promise-returning handlers flush before the asserts.
import { act, fireEvent, render, screen } from "@testing-library/react";
import MarkdownLink from "./MarkdownLink";

it("links to the markdown file and copies its absolute URL", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<MarkdownLink slug="some-slug" />);
  expect(screen.getByRole("link", { name: "Markdown file" })).toHaveAttribute(
    "href",
    "/initiative/some-slug.md",
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  expect(writeText).toHaveBeenCalledWith(`${location.origin}/initiative/some-slug.md`);
  expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
});
