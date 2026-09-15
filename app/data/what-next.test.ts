import { WHAT_NEXT } from "./what-next";

test("what happens next: one paragraph per type, differing on the process", () => {
  expect(WHAT_NEXT.grant).toMatch(
    /^If backers and donors fully fund this initiative, the team has 15 days/,
  );
  expect(WHAT_NEXT.rfp).toMatch(
    /^If backers and donors fully fund this initiative, a 30 day open RFP process begins/,
  );
  for (const t of ["grant", "rfp"] as const) {
    expect(WHAT_NEXT[t]).toContain(
      "ETHSecurity Badge holders will rank it against the other initiatives",
    );
    expect(WHAT_NEXT[t]).toMatch(/top-voted initiatives\.$/);
  }
});
