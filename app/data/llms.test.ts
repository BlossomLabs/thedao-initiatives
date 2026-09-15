import { readFileSync } from "node:fs";

// public/llms.txt is served at /llms.txt; the repo-root llms.txt is the source
// of truth that Griff edits. They must not drift. (Vitest runs from web/.)
test("public/llms.txt mirrors the repo-root llms.txt", () => {
  expect(readFileSync("public/llms.txt", "utf8")).toBe(readFileSync("llms.txt", "utf8"));
});
