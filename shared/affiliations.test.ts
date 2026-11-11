import { describe, expect, it } from "vitest";
import { normalizeAffiliations, parseAffiliations } from "./affiliations";

describe("vote affiliations", () => {
  it("trims, drops empties, and dedupes ignoring case, keeping the first spelling", () => {
    expect(normalizeAffiliations([" Seal ", "", "seal", "Wallets", "SEAL"])).toEqual([
      "Seal",
      "Wallets",
    ]);
  });
  it("a affiliation is 1–32 characters", () => {
    expect(normalizeAffiliations(["x".repeat(32)])).toEqual(["x".repeat(32)]);
    expect(() => normalizeAffiliations(["x".repeat(33)])).toThrow(
      "Affiliations are 1–32 characters",
    );
  });
  it("parseAffiliations reads a comma-separated list", () => {
    expect(parseAffiliations("Seal, Wallets ,, seal")).toEqual(["Seal", "Wallets"]);
    expect(parseAffiliations("")).toEqual([]);
  });
});
