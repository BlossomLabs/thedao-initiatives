import { adoptionFloor, type CheckInput, checkSubmission } from "./checks.ts";
import { SECTION_KEYS, SECTIONS } from "./sections.ts";
import type { Milestone, Sections } from "./types.ts";

const ms = (name: string, amount: number, extra: Partial<Milestone> = {}): Milestone => ({
  name,
  amount,
  adoption: false,
  done: false,
  link: "",
  month: "",
  criteria: ["Merged."],
  ...extra,
});

function minimal(goal: number, type: "rfp" | "grant" = "rfp"): CheckInput {
  const sections: Sections = {};
  for (const k of SECTION_KEYS) sections[k] = "Answered.";
  return {
    type,
    topup: false,
    page: {
      title: "A proper initiative title",
      summary: "This summary is comfortably longer than the forty character minimum required.",
      goal,
      duration: "6",
      recipient: type === "grant" ? "The team" : "",
      funders: "Some L2 and a wallet company",
      contact: "me@example.com",
    },
    sections,
    milestones: [ms("Delivered", goal, { adoption: true })],
    links: [],
    backers: [],
  };
}

const fields = (f: { field: string }[]) => f.map((x) => x.field);

test("the minimal payload passes for both types", () => {
  expect(checkSubmission(minimal(1000)).errors).toEqual([]);
  expect(checkSubmission(minimal(1000, "grant")).errors).toEqual([]);
});

test("sum mismatch blocks on goal", () => {
  const i = minimal(1000);
  i.milestones = [ms("A", 400, { adoption: true }), ms("B", 500)];
  expect(fields(checkSubmission(i).errors)).toEqual(["goal"]);
});

test("adoption rule blocks and the floor scales", () => {
  const i = minimal(150000);
  i.milestones = [ms("A", 150000)];
  expect(checkSubmission(i).errors[0].msg).toMatch(/^No milestone is an adoption milestone/);
  i.milestones = [ms("A", 125000), ms("B", 25000, { adoption: true })];
  expect(checkSubmission(i).errors[0].msg).toMatch(
    /^Adoption milestones carry \$25,000, which is 17%/,
  );
  expect(adoptionFloor(150000)).toBe(50000);
  expect(adoptionFloor(240000)).toBe(80000);
  expect(adoptionFloor(300000)).toBe(100000);
  expect(adoptionFloor(600000)).toBe(200000);
});

test("a top-up is exempt only when every milestone is done", () => {
  const i = minimal(1000, "grant");
  i.topup = true;
  i.milestones = [
    ms("A", 500, { done: true, link: "https://x.org/a" }),
    ms("B", 500, { done: true, link: "https://x.org/b" }),
  ];
  i.backers = [{ org: "Argot", amountUsd: 500, url: "" }];
  expect(checkSubmission(i).errors).toEqual([]);
  i.milestones[1].done = false;
  const f = checkSubmission(i);
  expect(fields(f.errors)).toEqual(["milestones"]);
  expect(fields(f.warnings)).toEqual(["ms_1_month"]);
  i.backers = [];
  expect(fields(checkSubmission(i).warnings)).toContain("backers");
});

test("missing fields, grant sections, and the missing kind", () => {
  const i = minimal(1000, "grant");
  i.page.contact = "";
  i.page.recipient = "";
  for (const k of ["team", "why_grant", "commitments"] as const) delete i.sections[k];
  const f = checkSubmission(i);
  expect(fields(f.errors)).toEqual([
    "recipient_team",
    "team",
    "why_grant",
    "commitments",
    "contact",
  ]);
  expect(f.errors.every((e) => e.kind === "missing")).toBe(true);
  const rfp = minimal(1000);
  expect(SECTIONS.rfp.every((k) => k in rfp.sections)).toBe(true);
});

test("criteria warnings do not block; https and month rules do", () => {
  const i = minimal(1000);
  i.milestones[0].criteria = [
    "Between 20-30 firms sign, as needed [TBD]",
    "See [the spec](https://x.org) for details",
  ];
  const f = checkSubmission(i);
  expect(f.errors).toEqual([]);
  expect(f.warnings).toEqual([{
    field: "ms_0_c0",
    msg:
      "Milestone A, not checkable yet: an unresolved bracket, TBD, a range, pick the floor, a hedge.",
  }]);
  i.links = ["http://x.org", "javascript:alert(1)", "https://ok.example/path"];
  i.milestones[0].link = "ftp://x";
  i.milestones[0].month = "2026-13";
  expect(fields(checkSubmission(i).errors)).toEqual([
    "ms_0_link",
    "ms_0_month",
    "links_0",
    "links_1",
  ]);
});

test("backer half rows and the edit scope", () => {
  const i = minimal(1000);
  i.backers = [{ org: "Org", amountUsd: 0, url: "" }, { org: "", amountUsd: 5, url: "" }, {
    org: "X",
    amountUsd: 5,
    url: "http://x.org",
  }];
  expect(fields(checkSubmission(i).errors)).toEqual(["bk_amount_0", "bk_org_1", "bk_url_2"]);
  i.page.contact = "";
  i.page.funders = "";
  i.page.duration = "";
  expect(checkSubmission(i, "edit").errors).toEqual([]);
});
