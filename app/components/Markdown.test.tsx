import { render } from "@testing-library/react";
import Markdown from "./Markdown";

// The markdown pipeline is the only place proposer text becomes markup, so
// these pin what v1's tests/test_markdown.py pinned: GFM renders, HTML does not.
function mount(text: string) {
  return render(<Markdown text={text} />).container;
}

test("GFM renders: headings, bold, lists, tables, task-list checkboxes", () => {
  const c = mount(
    "# Title\n\n**bold**\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n",
  );
  expect(c.querySelector("h1")?.textContent).toBe("Title");
  expect(c.querySelector("strong")?.textContent).toBe("bold");
  expect(c.querySelectorAll("ul li")).toHaveLength(4);
  expect(c.querySelector(".md-table table td")?.textContent).toBe("1");
  const boxes = c.querySelectorAll('li.task input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  expect((boxes[0] as HTMLInputElement).checked).toBe(true);
  expect((boxes[1] as HTMLInputElement).checked).toBe(false);
});

test("scripts, iframes, event handlers and javascript: URLs never reach the page", () => {
  const c = mount(
    [
      "<script>window.pwned = 1</script>",
      '<iframe src="https://evil.example"></iframe>',
      '<p onclick="window.pwned = 1">hi</p>',
      '<img src="x" onerror="window.pwned = 1">',
      "[click](javascript:window.pwned=1)",
    ].join("\n\n"),
  );
  expect(c.querySelector("script, iframe, img, [onclick], [onerror]")).toBeNull();
  const a = c.querySelector("a");
  expect(a).not.toBeNull();
  expect(a?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  expect(c.innerHTML).not.toContain("<script");
});

test("links open in a new tab with noopener", () => {
  const a = mount("[site](https://example.com/x)").querySelector("a");
  expect(a?.getAttribute("href")).toBe("https://example.com/x");
  expect(a?.getAttribute("target")).toBe("_blank");
  expect(a?.getAttribute("rel")).toContain("noopener");
});

test("empty text renders nothing", () => {
  expect(mount("").querySelector(".md")?.textContent).toBe("");
});
