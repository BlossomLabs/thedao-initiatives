import { readFileSync } from "node:fs";
import { parseTermsFile, TERMS } from "./terms";

test("terms file: version line is the gate version and leaves the body", () => {
  const t = parseTermsFile("version: 2026-09-06\n\n# Donation Terms\n\nBody.\n");
  expect(t.version).toBe("2026-09-06");
  expect(t.body.startsWith("# Donation Terms")).toBe(true);
  expect(() => parseTermsFile("# no version line\n")).toThrow();
  expect(() => parseTermsFile("version: 2026-09-06\n\n")).toThrow();
});

test("the bundled terms are the repo's content/donation-terms.md", () => {
  const file = readFileSync("../content/donation-terms.md", "utf8");
  expect(TERMS).toEqual(parseTermsFile(file));
  expect(TERMS.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(TERMS.body).not.toMatch(/^version:/m);
});
