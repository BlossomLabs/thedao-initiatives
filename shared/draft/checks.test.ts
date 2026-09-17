import { adoptionFloor, type CheckInput, checkSubmission } from "./checks.ts";
import { criterionTooLong, LIMITS, tooLong } from "./normalise.ts";
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

test("a top-up measures the adoption share against what this grant still raises", () => {
  // ethdebug in solc, 2026-09-15: goal 281,000, Argot committed 150,000
  expect(adoptionFloor(281_000, 150_000)).toBe(43_667);
  expect(adoptionFloor(500_000, 100_000)).toBe(133_334);
  const i = minimal(281_000, "grant");
  i.topup = true;
  i.backers = [{ org: "Argot", amountUsd: 150_000, url: "" }];
  i.milestones = [
    ms("Build", 236_000, { done: true, link: "https://x.org/a" }),
    ms("Adoption", 45_000, { adoption: true, month: "2027-06" }),
  ];
  expect(checkSubmission(i).errors).toEqual([]);
  i.topup = false;
  expect(checkSubmission(i).errors[0].msg).toMatch(
    /16% of the goal\. Raise them to at least \$93,667/,
  );
  i.topup = true;
  i.milestones[1].amount = 40_000;
  i.milestones[0].amount = 241_000;
  expect(checkSubmission(i).errors[0].msg).toMatch(
    /carry \$40,000, which is 31% of the \$131,000 this grant raises\. Raise them to at least \$43,667/,
  );
  // committed covers the whole goal: nothing left to raise, no adoption rule
  i.backers[0].amountUsd = 281_000;
  i.milestones[1].adoption = false;
  expect(checkSubmission(i).errors).toEqual([]);
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

test("a criterion past the character cap is an error on its own row, a 400-char one is fine", () => {
  const i = minimal(1000);
  i.milestones[0].criteria = ["x".repeat(400), "y".repeat(LIMITS.CRITERION_CHARS + 1)];
  const f = checkSubmission(i);
  expect(f.errors.map((e) => [e.field, e.msg, e.kind])).toEqual([
    ["ms_0_c1", criterionTooLong("A", 1), "cap"],
  ]);
});

test("every capped field reports too long on its own id instead of losing its tail", () => {
  const i = minimal(1000, "grant");
  i.page.title = "t".repeat(LIMITS.TITLE_CHARS + 1);
  i.page.summary = "s".repeat(LIMITS.SUMMARY_CHARS + 1);
  i.page.recipient = "r".repeat(LIMITS.RECIPIENT_CHARS + 1);
  i.page.reviewer = "v".repeat(LIMITS.REVIEWER_CHARS + 1);
  i.page.funders = "f".repeat(LIMITS.FUNDERS_CHARS + 1);
  i.page.contact = "c".repeat(LIMITS.CONTACT_CHARS + 1);
  i.milestones[0].name = "n".repeat(LIMITS.MILESTONE_NAME + 1);
  i.milestones[0].link = "https://x.org/" + "a".repeat(LIMITS.LINK_CHARS);
  i.backers = [{ org: "o".repeat(LIMITS.BACKER_ORG + 1), amountUsd: 1, url: "" }];
  const f = checkSubmission(i);
  expect([...fields(f.errors)].sort()).toEqual([
    "bk_org_0",
    "contact",
    "funders",
    "milestone_reviewer",
    "ms_0_link",
    "ms_0_name",
    "recipient_team",
    "summary",
    "title",
  ]);
  expect(f.errors.find((e) => e.field === "title")!.msg).toBe(
    "The title is too long (140 characters at most).",
  );
  // every cap finding carries the "cap" kind, so an admin save can block on it
  expect(f.errors.map((e) => e.kind)).toEqual(f.errors.map(() => "cap"));
  // at the cap exactly is fine
  i.page.title = "t".repeat(LIMITS.TITLE_CHARS);
  expect(fields(checkSubmission(i).errors)).not.toContain("title");
});

test("a recipient or backer link past the cap says too long, not not-https", () => {
  const i = minimal(1000, "grant");
  const long = "https://x.org/" + "a".repeat(LIMITS.LINK_CHARS);
  i.page.recipientUrl = long;
  i.backers = [{ org: "Org", amountUsd: 5, url: long }];
  const f = checkSubmission(i);
  expect(f.errors.map((e) => [e.field, e.msg])).toEqual([
    ["recipient_url", tooLong("The recipient link", LIMITS.LINK_CHARS)],
    ["bk_url_0", tooLong("Org: the link", LIMITS.LINK_CHARS)],
  ]);
});

test("trailing whitespace at the cap is not too long: the caps measure the trimmed text", () => {
  const i = minimal(1000, "grant");
  i.page.title = "t".repeat(LIMITS.TITLE_CHARS) + " ";
  i.page.summary = "s".repeat(LIMITS.SUMMARY_CHARS) + "\n";
  i.page.recipient = "r".repeat(LIMITS.RECIPIENT_CHARS) + " ";
  i.page.funders = "f".repeat(LIMITS.FUNDERS_CHARS) + " ";
  i.page.contact = "c".repeat(LIMITS.CONTACT_CHARS) + " ";
  i.milestones[0].name = "n".repeat(LIMITS.MILESTONE_NAME) + " ";
  expect(checkSubmission(i).errors).toEqual([]);
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

test("a discussion link past the cap is too long on submit, never cut in silence", () => {
  const i = minimal(90_000);
  i.page.discourseUrl = "https://forum.example.org/t/" + "a".repeat(LIMITS.LINK_CHARS);
  const r = checkSubmission(i);
  expect(r.errors.filter((e) => e.field === "discourse_url").map((e) => [e.msg, e.kind])).toEqual(
    [[tooLong("The discussion link", LIMITS.LINK_CHARS), "cap"]],
  );
  // the edit scope leaves the page facts to the route that edits them
  expect(fields(checkSubmission(i, "edit").errors)).toEqual([]);
});

test("an other link past the cap says too long, not not-https", () => {
  const i = minimal(90_000);
  i.links = ["https://example.org/" + "a".repeat(LIMITS.LINK_CHARS), "https://ok.example/path"];
  const r = checkSubmission(i);
  expect(
    r.errors.filter((e) => e.field.startsWith("links")).map((e) => [e.field, e.msg, e.kind]),
  ).toEqual([["links_0", tooLong("Link 1", LIMITS.LINK_CHARS), "cap"]]);
});

test("a backer whose name is itself over the cap is called by its row in the link message", () => {
  const i = minimal(90_000);
  i.backers = [{
    org: "O".repeat(LIMITS.BACKER_ORG + 1),
    amountUsd: 1000,
    url: "https://example.org/" + "a".repeat(LIMITS.LINK_CHARS),
  }];
  const r = checkSubmission(i);
  expect(r.errors.filter((e) => e.field === "bk_url_0").map((e) => e.msg)).toEqual([
    tooLong("Backer 1: the link", LIMITS.LINK_CHARS),
  ]);
});
