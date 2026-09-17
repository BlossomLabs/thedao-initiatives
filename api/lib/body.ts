import type { Context } from "hono";
import { HttpError } from "./errors.ts";

/** Unknown and retired fields use the same error, including nested field paths. */
export function assertFields(body: object, allowed: readonly string[], path = ""): void {
  const field = Object.keys(body).find((key) => !allowed.includes(key));
  if (field !== undefined) throw new HttpError(400, `Unsupported field: ${path}${field}.`);
}

/** Every JSON write declares its fields; an empty list also covers bodyless actions. */
export async function jsonBody(
  c: Context,
  allowed: readonly string[],
): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Expected a JSON object.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected a JSON object.");
  }
  assertFields(body, allowed);
  return body as Record<string, unknown>;
}

/** Check both text and file field names before a caller uploads or stores anything. */
export async function formBody(c: Context, allowed: readonly string[]): Promise<FormData> {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Expected form data.");
  assertFields(Object.fromEntries(form), allowed);
  return form;
}

export const s = (v: unknown, max = 10_000): string => String(v ?? "").trim().slice(0, max);
