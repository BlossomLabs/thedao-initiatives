import { describe, expect, it } from "vitest";
import type { FunderLead } from "./api-types";
import { leadsCsv } from "./leads-csv";

const lead: FunderLead = {
  id: "lead-1",
  title: "Community grants",
  slug: "community-grants",
  type: "rfp",
  status: "pending",
  goalUsd: 12000.5,
  funders: "Acme Foundation",
  contact: "donor@example.com",
  createdAt: Date.parse("2026-09-16T12:00:00Z") / 1000,
};

/** Independent CSV reader for field/record boundary checks, including embedded CR/LF. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (ch === "," || ch === "\r" || ch === "\n")) {
      row.push(field);
      field = "";
      if (ch !== ",") {
        if (ch === "\r" && csv[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else field += ch;
  }
  expect(quoted).toBe(false);
  expect(field).toBe("");
  expect(row).toEqual([]);
  return rows;
}

const exportedFunder = (funders: string) => parseCsv(leadsCsv([{ ...lead, funders }]))[1][5];

it("keeps the CRM's column schema, ordinary text, timestamps and numeric goals", () => {
  const csv = leadsCsv([lead]);
  expect(parseCsv(csv)).toEqual([
    ["initiative", "slug", "type", "status", "goal_usd", "funders", "contact", "created_at"],
    [
      "Community grants",
      "community-grants",
      "rfp",
      "pending",
      "12000.5",
      "Acme Foundation",
      "donor@example.com",
      "2026-09-16T12:00:00Z",
    ],
  ]);
  expect(csv).toContain(',12000.5,"Acme Foundation"');
  expect(csv.endsWith("\r\n")).toBe(true);
  expect(parseCsv(leadsCsv([]))).toHaveLength(1);
});

describe("formula text is visibly literalized", () => {
  for (
    const value of ["=1+1", "+1+1", "-1+1", "@SUM(1,1)", "＝1+1", "＋1+1", "－1+1", "＠SUM(1,1)"]
  ) {
    it(JSON.stringify(value), () => expect(exportedFunder(value)).toBe("Text: " + value));
  }
  for (
    const prefix of [
      " ",
      "   ",
      "\t",
      "\r",
      "\n",
      "\r\n",
      "\u0000",
      "\u001b",
      "\u007f",
      "\u0085",
      "\u00a0",
      "\u200b",
      "\u202e",
      "\ufeff",
      "'",
      '"',
      " '\t\ufeff",
    ]
  ) {
    it(`detects formulas after ${JSON.stringify(prefix)}`, () => {
      const value = prefix + "=1+1";
      expect(exportedFunder(value)).toBe("Text: " + value);
    });
  }
});

it("literalizes leading control characters even without a visible formula operator", () => {
  for (const value of ["\tHello", "  \nAcme", "\r@example.com", "\u0000Acme", "\u200bAcme"]) {
    expect(exportedFunder(value)).toBe("Text: " + value);
  }
});

it("treats all text columns as untrusted, including unexpected runtime enum and numeric values", () => {
  const untrusted = {
    ...lead,
    title: "=1+1",
    slug: "+1+1",
    type: "-1+1",
    status: "@SUM(1,1)",
    funders: "＝1+1",
    contact: "+34123456789",
    goalUsd: "=1+1",
  } as unknown as FunderLead;
  expect(parseCsv(leadsCsv([untrusted]))[1].slice(0, 7)).toEqual([
    "Text: =1+1",
    "Text: +1+1",
    "Text: -1+1",
    "Text: @SUM(1,1)",
    "Text: =1+1",
    "Text: ＝1+1",
    "Text: +34123456789",
  ]);
});

it("preserves legitimate numeric goals, including fractions, negatives, zero and exponent notation", () => {
  for (const goalUsd of [0, 42, 12.25, -5, 1e21, 0.000001]) {
    const csv = leadsCsv([{ ...lead, goalUsd }]);
    expect(parseCsv(csv)[1][4]).toBe(String(goalUsd));
    expect(csv).toContain(`,${String(goalUsd)},`);
  }
});

it("escapes embedded quotes, commas, semicolons and newlines without creating executable extra cells", () => {
  const payloads = [
    '=1+2";=1+2',
    "=1+2'\" ;,=1+2",
    'Acme",=1+1,"other',
    'Acme"\r\n=1+1,"other',
    "Acme, Inc.; partners\r\nSecond line",
    'He said "hello"; =1+1',
  ];
  const csv = leadsCsv(payloads.map((funders) => ({ ...lead, funders })));
  const rows = parseCsv(csv);
  expect(rows).toHaveLength(payloads.length + 1);
  expect(rows.every((row) => row.length === 8)).toBe(true);
  expect(rows.slice(1).map((row) => row[5])).toEqual(
    payloads.map((value, i) => i < 2 ? "Text: " + value : value),
  );
});

it("retains the visible marker across an ordinary CSV parse/save/reopen without special escaping", () => {
  const values = ["=1+1", "\t+1+1", "'@SUM(1,1)", "－1+1"];
  const parsed = parseCsv(leadsCsv(values.map((funders) => ({ ...lead, funders }))));
  // Model a normal CSV writer which knows nothing about spreadsheet text escapes.
  const rewritten =
    parsed.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join(
      "\r\n",
    ) + "\r\n";
  expect(parseCsv(rewritten).slice(1).map((row) => row[5])).toEqual(
    values.map((value) => "Text: " + value),
  );
});
