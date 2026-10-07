import { describe, expect, it } from "vitest";
import { type AdminQuery, parseAdminQuery, setQualifier } from "./admin-query";

const parsed = (q: string): AdminQuery => parseAdminQuery(q).query;

describe("parseAdminQuery", () => {
  it("reads qualifiers and keeps the rest as words", () => {
    expect(parsed("type:grant status:pending First QA")).toEqual({
      type: "grant",
      status: "pending",
      cats: [],
      funding: "all",
      edit: "all",
      words: ["first", "qa"],
    });
  });

  it("an empty query filters nothing", () => {
    expect(parsed("   ")).toEqual({
      type: "all",
      status: "all",
      cats: [],
      funding: "all",
      edit: "all",
      words: [],
    });
  });

  it("any case, qualifiers anywhere, the last of a repeated one wins", () => {
    const q = parsed("Echidna STATUS:Approved type:rfp type:GRANT");
    expect(q.status).toBe("approved");
    expect(q.type).toBe("grant");
    expect(q.words).toEqual(["echidna"]);
  });

  it("quotes keep a phrase together", () => {
    expect(parsed('"First QA" status:pending').words).toEqual(["first qa"]);
  });

  it("categories: slugs, comma lists, repeats, and untagged", () => {
    expect(parsed("cat:opsec,defi cat:compilers").cats).toEqual(["opsec", "defi", "compilers"]);
    expect(parsed("cat:untagged").cats).toEqual(["untagged"]);
  });

  it("edit: review, for initiatives with a proposer's edit waiting", () => {
    expect(parsed("edit:review").edit).toBe("review");
    const bad = parseAdminQuery("edit:done");
    expect(bad.query.edit).toBe("all");
    expect(bad.problems).toEqual(["Unknown edit: done. Try review."]);
  });

  it("funding: open or funded", () => {
    expect(parsed("funding:funded").funding).toBe("funded");
  });

  it("an unknown value is reported and ignored, never read as words", () => {
    const r = parseAdminQuery("status:pendng cat:nope type:loan hello");
    expect(r.query.status).toBe("all");
    expect(r.query.cats).toEqual([]);
    expect(r.query.type).toBe("all");
    expect(r.query.words).toEqual(["hello"]);
    expect(r.problems).toEqual([
      "Unknown status: pendng. Try pending, approved, rejected or archived.",
      "Unknown category: nope.",
      "Unknown type: loan. Try grant or rfp.",
    ]);
  });

  it("an unknown qualifier name stays a word (a URL or a time)", () => {
    expect(parsed("https://x.example 10:30").words).toEqual(["https://x.example", "10:30"]);
  });
});

describe("setQualifier", () => {
  it("adds a qualifier and keeps the words and their order", () => {
    expect(setQualifier("First QA", "status", "pending")).toBe("First QA status:pending");
  });

  it("replaces the same qualifier, whatever its case, in place", () => {
    expect(setQualifier("type:rfp Echidna STATUS:approved", "status", "pending"))
      .toBe("type:rfp Echidna status:pending");
  });

  it("removes it when the pill goes back to all", () => {
    expect(setQualifier("status:pending First QA", "status", "all")).toBe("First QA");
    expect(setQualifier("cat:opsec cat:defi x", "cat", [])).toBe("x");
  });

  it("writes categories as one comma list", () => {
    expect(setQualifier("x", "cat", ["opsec", "defi"])).toBe("x cat:opsec,defi");
  });

  it("keeps quoted phrases intact", () => {
    expect(setQualifier('"First QA"', "type", "grant")).toBe('"First QA" type:grant');
  });
});
