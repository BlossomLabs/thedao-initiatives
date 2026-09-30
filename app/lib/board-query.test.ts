import { expect, it } from "vitest";
import { boardQueryText, parseBoardQuery, setBoardQualifier } from "./board-query";

it("reads type:, cat: and funding:, the rest are the keyword words", () => {
  expect(parseBoardQuery("type:grant cat:opsec,defi funding:open wallet safety")).toEqual({
    query: { type: "grant", cats: ["opsec", "defi"], status: "open", words: ["wallet", "safety"] },
    problems: [],
  });
  expect(parseBoardQuery("TYPE:RFP").query.type).toBe("rfp");
  expect(parseBoardQuery('"secure element"').query.words).toEqual(["secure element"]);
});

it("an unknown value is named and ignored; other colons are just words", () => {
  const r = parseBoardQuery("type:loan cat:nope funding:soon 10:30");
  expect(r.query).toEqual({ type: "all", cats: [], status: "all", words: ["10:30"] });
  expect(r.problems).toEqual([
    "Unknown type: loan. Try grant or rfp.",
    "Unknown category: nope.",
    "Unknown funding: soon. Try open, funded or first-goal.",
  ]);
});

it("a pill rewrites its qualifier and keeps the words", () => {
  expect(setBoardQualifier("wallet", "type", "grant")).toBe("wallet type:grant");
  expect(setBoardQualifier("wallet type:rfp", "type", "all")).toBe("wallet");
  expect(setBoardQualifier("wallet", "cat", ["opsec", "defi"])).toBe("wallet cat:opsec,defi");
  expect(setBoardQualifier("x", "funding", "funded")).toBe("x funding:funded");
});

it("the box text for a view: its words, then its qualifiers", () => {
  expect(boardQueryText({ q: "wallet", type: "grant", cats: ["opsec"], status: "open" }))
    .toBe("wallet type:grant cat:opsec funding:open");
  expect(boardQueryText({ q: "", type: "all", cats: [], status: "all" })).toBe("");
});
