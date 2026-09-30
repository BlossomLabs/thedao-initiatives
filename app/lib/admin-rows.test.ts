import { expect, it } from "vitest";
import { approvedCounts, filterAdminRows } from "./admin-rows";
import type { AdminInitiative } from "~/lib/api-types";

const row = (over: Partial<AdminInitiative>) => ({
  initiative: {
    title: "",
    contact: "",
    categories: [],
    status: "approved",
    type: "grant",
    ...over,
  } as AdminInitiative,
});

const rows = [
  row({ title: "Echidna fuzzing", contact: "Gustavo @ggrieco", categories: ["fuzzing-testing"] }),
  row({
    title: "Safe Lockdown Guard",
    contact: "ops@safe.example",
    type: "rfp",
    categories: ["opsec"],
  }),
  row({ title: "Untagged thing", contact: "", status: "pending" }),
];
const titles = (xs: typeof rows) => xs.map((x) => x.initiative.title);

it("search matches part of the project name or the contact, every word, any case", () => {
  expect(titles(filterAdminRows(rows, "all", "lockdown"))).toEqual(["Safe Lockdown Guard"]);
  expect(titles(filterAdminRows(rows, "all", "GRIECO"))).toEqual(["Echidna fuzzing"]);
  expect(titles(filterAdminRows(rows, "all", "safe.example"))).toEqual(["Safe Lockdown Guard"]);
  expect(titles(filterAdminRows(rows, "all", "echidna gustavo"))).toEqual(["Echidna fuzzing"]);
  expect(titles(filterAdminRows(rows, "all", "echidna safe"))).toEqual([]);
  expect(filterAdminRows(rows, "all", "  ")).toHaveLength(3);
});

it("search combines with the category filter, including Untagged", () => {
  expect(titles(filterAdminRows(rows, "opsec", "safe"))).toEqual(["Safe Lockdown Guard"]);
  expect(titles(filterAdminRows(rows, "opsec", "echidna"))).toEqual([]);
  expect(titles(filterAdminRows(rows, "untagged", ""))).toEqual(["Untagged thing"]);
});

it("counts approved initiatives by type, and grants plus RFPs is the total", () => {
  expect(approvedCounts(rows)).toEqual({ total: 2, grants: 1, rfps: 1 });
  expect(approvedCounts([])).toEqual({ total: 0, grants: 0, rfps: 0 });
});
