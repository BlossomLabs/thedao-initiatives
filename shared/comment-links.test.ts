import { describe, expect, it } from "vitest";
import { commentLinks, isKnownDomain, mostlyLinks } from "./comment-links";

describe("comment links", () => {
  it("finds each link once, with its domain, trailing punctuation dropped", () => {
    expect(
      commentLinks("See https://github.com/a/b. And www.Example.com/x, https://github.com/a/b."),
    )
      .toEqual([
        { url: "https://github.com/a/b", domain: "github.com", known: true },
        { url: "www.Example.com/x", domain: "example.com", known: false },
      ]);
  });

  it("knows the board, code hosts and forums, and their subdomains, nothing else", () => {
    expect(isKnownDomain("initiatives.thedao.fund")).toBe(true);
    expect(isKnownDomain("ethresear.ch")).toBe(true);
    expect(isKnownDomain("ethereum-magicians.org")).toBe(true);
    expect(isKnownDomain("github.com.evil.io")).toBe(false);
    expect(isKnownDomain("notgithub.com")).toBe(false);
    expect(isKnownDomain("")).toBe(false);
  });

  it("calls a bare link, or a link with a few words, mostly links", () => {
    expect(mostlyLinks("https://example.com/claim")).toBe(true);
    expect(mostlyLinks("look: https://example.com/claim")).toBe(true);
    expect(mostlyLinks("no links at all")).toBe(false);
    expect(
      mostlyLinks(
        "The audit report linked here covers the reentrancy finding we discussed: https://github.com/a/b",
      ),
    ).toBe(false);
  });
});
