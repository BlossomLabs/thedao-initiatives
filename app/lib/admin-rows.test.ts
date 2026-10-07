import { expect, it } from "vitest";
import { adminFacetCounts, approvedCounts, filterAdminRows } from "./admin-rows";
import { parseAdminQuery } from "./admin-query";
import type { AdminInitiative } from "~/lib/api-types";

const row = (over: Partial<AdminInitiative>, total = 0) => ({
  initiative: {
    title: "",
    contact: "",
    categories: [],
    status: "approved",
    type: "grant",
    goalUsd: 100,
    ...over,
  } as AdminInitiative,
  summary: { total },
});

const rows = [
  row(
    { title: "Echidna fuzzing", contact: "Gustavo @ggrieco", categories: ["fuzzing-testing"] },
    100,
  ),
  row({
    title: "Safe Lockdown Guard",
    contact: "ops@safe.example",
    type: "rfp",
    categories: ["opsec"],
  }),
  row({ title: "First QA grant", contact: "", status: "pending" }),
  row({ title: "First QA rfp", type: "rfp", status: "rejected", categories: ["opsec", "defi"] }),
];
// the second row has a proposer's edit waiting
rows[1].initiative.pendingRevision = 3;
const titles = (q: string) =>
  filterAdminRows(rows, parseAdminQuery(q).query).map((x) => x.initiative.title);

it("words match part of the project name or the contact, every word, any case", () => {
  expect(titles("lockdown")).toEqual(["Safe Lockdown Guard"]);
  expect(titles("GRIECO")).toEqual(["Echidna fuzzing"]);
  expect(titles("safe.example")).toEqual(["Safe Lockdown Guard"]);
  expect(titles("echidna gustavo")).toEqual(["Echidna fuzzing"]);
  expect(titles("echidna safe")).toEqual([]);
  expect(titles("  ")).toHaveLength(4);
});

it("the user's example: type:grant status:pending First QA", () => {
  expect(titles("type:grant status:pending First QA")).toEqual(["First QA grant"]);
  expect(titles("First QA")).toEqual(["First QA grant", "First QA rfp"]);
});

it("each qualifier narrows, and they combine", () => {
  expect(titles("type:rfp")).toEqual(["Safe Lockdown Guard", "First QA rfp"]);
  expect(titles("status:rejected")).toEqual(["First QA rfp"]);
  expect(titles("cat:opsec")).toEqual(["Safe Lockdown Guard", "First QA rfp"]);
  expect(titles("cat:defi,fuzzing-testing")).toEqual(["Echidna fuzzing", "First QA rfp"]);
  expect(titles("cat:untagged")).toEqual(["First QA grant"]);
  expect(titles("edit:review")).toEqual(["Safe Lockdown Guard"]);
  expect(titles("edit:review type:grant")).toEqual([]);
  expect(titles("funding:funded")).toEqual(["Echidna fuzzing"]);
  expect(titles("funding:open type:rfp status:approved")).toEqual(["Safe Lockdown Guard"]);
});

it("pill counts: each facet counted with the other filters applied", () => {
  const c = adminFacetCounts(rows, parseAdminQuery("type:rfp").query);
  expect(c.type).toEqual({ all: 4, grant: 2, rfp: 2 });
  expect(c.status).toEqual({ all: 2, pending: 0, approved: 1, rejected: 1, archived: 0 });
  expect(c.cats).toEqual({ opsec: 2, defi: 1 });
});

it("counts approved initiatives by type, and grants plus RFPs is the total", () => {
  expect(approvedCounts(rows)).toEqual({ total: 2, grants: 1, rfps: 1 });
  expect(approvedCounts([])).toEqual({ total: 0, grants: 0, rfps: 0 });
});
