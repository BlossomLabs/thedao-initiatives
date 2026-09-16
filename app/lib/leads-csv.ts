import type { FunderLead } from "./api-types";

/**
 * Literalize formula-capable text with a visible ordinary-text marker. Unlike
 * apostrophe/tab escapes, it does not depend on spreadsheet import settings or
 * on the consumer retaining a special escape when saving the CSV again.
 * Preserve the entire original value after the marker for CRM import/review.
 */
function textCell(value: unknown): string {
  const text = String(value ?? "");
  // Some importers skip whitespace, controls, invisible formatting, or leading
  // quotes before detecting formulas. Check the first meaningful character too.
  const prefix = /^[\s\p{Cc}\p{Cf}'"]*/u.exec(text)![0];
  const formula = /^[=+\-@＝＋－＠]/u.test(text.slice(prefix.length));
  const control = /[\p{Cc}\p{Cf}]/u.test(prefix);
  const literal = formula || control ? "Text: " + text : text;
  // Quote every text field and double embedded quotes: input cannot create an
  // extra cell/row, including when it contains separators, CR/LF, or quotes.
  return `"${literal.replaceAll('"', '""')}"`;
}

/** Comma-delimited UTF-8 CSV, with numeric goals kept as actual numeric cells. */
export function leadsCsv(rows: FunderLead[]): string {
  const head = [
    "initiative",
    "slug",
    "type",
    "status",
    "goal_usd",
    "funders",
    "contact",
    "created_at",
  ];
  const lines = rows.map((row) => {
    const goal = typeof row.goalUsd === "number" && Number.isFinite(row.goalUsd)
      ? String(row.goalUsd)
      : textCell(row.goalUsd);
    return [
      textCell(row.title),
      textCell(row.slug),
      textCell(row.type),
      textCell(row.status),
      goal,
      textCell(row.funders),
      textCell(row.contact),
      textCell(new Date(row.createdAt * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")),
    ].join(",");
  });
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
