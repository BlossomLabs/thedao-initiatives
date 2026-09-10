import { describe, expect, it } from "vitest";
import { changed, diffRevisions, diffText } from "./revision-diff";

const join = (chunks: ReturnType<typeof diffText>, keep: "before" | "after") =>
  chunks.filter((c) => keep === "before" ? !c.added : !c.removed).map((c) => c.value).join("");

describe("revision diff", () => {
  it("marks inserted and removed words and reconstructs both sides", () => {
    const d = diffText("a quick fox", "a slow\nfox");
    expect(join(d, "before")).toBe("a quick fox");
    expect(join(d, "after")).toBe("a slow\nfox");
    expect(d.filter((c) => c.removed).map((c) => c.value).join("")).toContain("quick");
    expect(d.filter((c) => c.added).map((c) => c.value).join("")).toContain("slow");
    expect(changed(d)).toBe(true);
    expect(changed(diffText("same", "same"))).toBe(false);
  });
  it("treats a missing previous revision as all new", () => {
    const d = diffRevisions(null, { title: "T", summary: "S", details: "" });
    expect(d.title).toEqual([{ value: "T", added: true, removed: false }]);
    expect(d.details).toEqual([]);
  });
});
