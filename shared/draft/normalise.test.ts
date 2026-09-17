import { bodyKey } from "./body-key.ts";
import {
  inputMax,
  isStructured,
  LIMITS,
  normaliseStructured,
  sameStructured,
  structuredBytes,
} from "./normalise.ts";

test("normalise drops empty and other-type sections, strips headings, clips", () => {
  const s = normaliseStructured({
    sections: { why: "## Heading\ntext ", team: "grant only", existing: "" },
    milestones: [{ name: " A ", amount: "1,000", criteria: ["x", " ", "y"], extra: 1 }, "junk"],
    links: "https://a.org\n\nhttps://a.org\nhttps://b.org",
  }, "rfp");
  expect(s.sections).toEqual({ why: "**Heading**\ntext" });
  expect(s.milestones).toEqual([{
    name: "A",
    amount: 1000,
    adoption: false,
    done: false,
    link: "",
    month: "",
    criteria: ["x", "y"],
  }]);
  expect(s.links).toEqual(["https://a.org", "https://b.org"]);
});

test("a long criterion keeps one character past the cap so the check can report it", () => {
  const long = "y".repeat(LIMITS.CRITERION_CHARS + 50);
  const s = normaliseStructured({
    sections: {},
    milestones: [{ name: "A", amount: 1, criteria: ["x".repeat(400), long] }],
    links: [],
  }, "rfp");
  expect(s.milestones[0].criteria[0].length).toBe(400);
  expect(s.milestones[0].criteria[1].length).toBe(LIMITS.CRITERION_CHARS + 1);
});

test("a milestone name or link past its cap keeps one character over, never a silent cut", () => {
  const s = normaliseStructured({
    sections: {},
    milestones: [{
      name: "n".repeat(LIMITS.MILESTONE_NAME + 40),
      amount: 1,
      link: "https://x.org/" + "a".repeat(LIMITS.LINK_CHARS),
      criteria: ["x"],
    }],
    links: [],
  }, "rfp");
  expect(s.milestones[0].name.length).toBe(LIMITS.MILESTONE_NAME + 1);
  expect(s.milestones[0].link.length).toBe(LIMITS.LINK_CHARS + 1);
});

test("sameStructured ignores key order and whitespace; bytes count UTF-8", () => {
  const a = normaliseStructured({
    sections: { in_scope: "b", why: "a " },
    milestones: [],
    links: [],
  }, "rfp");
  const b = normaliseStructured({
    sections: { why: "a", in_scope: "b" },
    milestones: [],
    links: [],
  }, "rfp");
  expect(sameStructured(a, b)).toBe(true);
  expect(
    structuredBytes(
      normaliseStructured({ sections: { why: "é" }, milestones: [], links: [] }, "rfp"),
    ),
  )
    .toBeGreaterThan(
      structuredBytes(
        normaliseStructured({ sections: { why: "e" }, milestones: [], links: [] }, "rfp"),
      ),
    );
  expect(isStructured({ sections: {}, milestones: [] })).toBe(false);
  expect(isStructured({ sections: { why: "x" }, milestones: [] })).toBe(true);
});

test("body key normalises whitespace and case and includes milestones", () => {
  const k1 = bodyKey({ why: "Hello   World" }, [{
    name: "M",
    amount: 1,
    adoption: false,
    done: false,
    link: "",
    month: "",
    criteria: ["c1"],
  }]);
  const k2 = bodyKey({ why: "hello world" }, [{
    name: "m",
    amount: 2,
    adoption: true,
    done: false,
    link: "",
    month: "",
    criteria: ["C1"],
  }]);
  expect(k1).toBe(k2);
  expect(bodyKey({}, [])).toBe("");
});

test("inputMax leaves room for a whole emoji past the cap, so the checks can report it", () => {
  // 71 emoji are 142 UTF-16 units: over the 140 cap by one character. A
  // maxLength of cap+1 would make the browser drop the 71st in silence.
  const title = "🔥".repeat(LIMITS.TITLE_CHARS / 2 + 1);
  expect(title.length).toBeLessThanOrEqual(inputMax(LIMITS.TITLE_CHARS));
  expect(title.length).toBeGreaterThan(LIMITS.TITLE_CHARS);
});
