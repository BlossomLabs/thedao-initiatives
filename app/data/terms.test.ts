import { readdirSync, readFileSync } from "node:fs";
import { sha256, stringToBytes } from "viem";
import {
  formatEffectiveDate,
  parseTermsFile,
  TERMS,
  TERMS_VERSIONS,
  termsById,
  termsVersionId,
} from "./terms";

const FILE = "version: 2026-09-06\n\n# Donation Terms\n\nBody.\n";

test("terms file: header lines give the effective date and the material flag", () => {
  const t = parseTermsFile(FILE, "2026-09-06.md");
  expect(t.effectiveDate).toBe("2026-09-06");
  expect(t.material).toBe(false);
  expect(t.body.startsWith("# Donation Terms")).toBe(true);
  expect(t.body).not.toMatch(/^version:/m);
  const m = parseTermsFile("version: 2026-09-06\nmaterial: true\n\n# T\n", "2026-09-06.md");
  expect(m.material).toBe(true);
  expect(m.body).toBe("# T");
});

test("terms file: rejects a missing or bad version, unknown headers, an empty body", () => {
  expect(() => parseTermsFile("# no version line\n", "x.md")).toThrow(/version/);
  expect(() => parseTermsFile("version: v2\n\n# T\n", "v2.md")).toThrow(/YYYY-MM-DD/);
  expect(() => parseTermsFile("version: 2026-02-30\n\n# T\n", "2026-02-30.md")).toThrow(/date/);
  expect(() => parseTermsFile("version: 2026-09-06\nauthor: x\n\n# T\n", "2026-09-06.md"))
    .toThrow(/author/);
  expect(() => parseTermsFile("version: 2026-09-06\n\n", "2026-09-06.md")).toThrow(/empty/);
  // The file name is the effective date.
  expect(() => parseTermsFile(FILE, "2026-09-07.md")).toThrow(/2026-09-07/);
});

test("version id: sha256 of the effective date plus the body; the material flag is not in it", () => {
  const id = termsVersionId("2026-01-01", "# T");
  expect(id).toMatch(/^[0-9a-f]{64}$/);
  expect(id).toBe(sha256(stringToBytes("2026-01-01\n# T")).slice(2));
  expect(parseTermsFile("version: 2026-01-01\n\n# T\n", "2026-01-01.md").id).toBe(id);
  expect(parseTermsFile("version: 2026-01-01\nmaterial: true\n\n# T\n", "2026-01-01.md").id)
    .toBe(id);
  expect(termsVersionId("2026-01-01", "# T!")).not.toBe(id);
  expect(termsVersionId("2026-01-02", "# T")).not.toBe(id);
});

test("the bundled versions are content/donation-terms/*.md, newest first, the current is the latest", () => {
  const dir = "content/donation-terms";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse();
  expect(files.length).toBeGreaterThan(0);
  const parsed = files.map((f) => parseTermsFile(readFileSync(`${dir}/${f}`, "utf8"), f));
  expect(TERMS_VERSIONS).toEqual(parsed);
  expect(TERMS).toEqual(parsed[0]);
  expect(new Set(TERMS_VERSIONS.map((v) => v.id)).size).toBe(TERMS_VERSIONS.length);
  expect(termsById(TERMS.id)).toBe(TERMS);
  expect(termsById("f".repeat(64))).toBeUndefined();
});

test("formatEffectiveDate is a long UTC date", () => {
  expect(formatEffectiveDate("2026-09-06")).toBe("September 6, 2026");
  expect(formatEffectiveDate("2026-12-31")).toBe("December 31, 2026");
});
