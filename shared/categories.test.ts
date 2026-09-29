import { categoriesText, readCategoryText } from "./categories.ts";

test("reads labels and slugs, one per line, with bullets or numbers, any case", () => {
  expect(readCategoryText("- OpSec\n2. research & education\n* defi").slugs)
    .toEqual(["opsec", "research-education", "defi"]);
});

test("reads commas and semicolons, 'and' for '&', and drops duplicates", () => {
  expect(readCategoryText("Wallets and Signing, wallets-signing; Audits & Analysis").slugs)
    .toEqual(["wallets-signing", "audits-analysis"]);
});

test("keeps the first three known ones, primary first", () => {
  const r = readCategoryText("Compilers & Languages, Formal Verification, OpSec, DeFi Safety");
  expect(r.slugs).toEqual(["compilers", "formal-verification", "opsec"]);
});

test("names what it could not read", () => {
  const r = readCategoryText("OpSec\nBlockchain stuff\n\nZK");
  expect(r.slugs).toEqual(["opsec"]);
  expect(r.unknown).toEqual(["Blockchain stuff", "ZK"]);
});

test("empty text reads as none", () => {
  expect(readCategoryText("")).toEqual({ slugs: [], unknown: [] });
});

test("writes labels one per line, and reads them back in order", () => {
  const text = categoriesText(["defi", "opsec"]);
  expect(text).toBe("DeFi Safety\nOpSec");
  expect(readCategoryText(text).slugs).toEqual(["defi", "opsec"]);
});
