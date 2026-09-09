import type { Context } from "hono";

/** Parse a JSON object body; anything else becomes {}. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const s = (v: unknown, max = 10_000): string => String(v ?? "").trim().slice(0, max);
