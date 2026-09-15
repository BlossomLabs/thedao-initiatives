import { monthLabel } from "./format";

test("monthLabel: YYYY-MM to a short month, anything else untouched", () => {
  expect(monthLabel("2026-11")).toBe("Nov 2026");
  expect(monthLabel("2027-01")).toBe("Jan 2027");
  expect(monthLabel("2026-13")).toBe("2026-13");
  expect(monthLabel("soon")).toBe("soon");
  expect(monthLabel("")).toBe("");
});
