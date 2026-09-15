/**
 * Submitting a draft: the backer logos go up first, one multipart request
 * each (the API caps a body at 2 MiB), then the initiative as JSON. A 400
 * with findings becomes a FindingsError so the form can paint them.
 */
import type { Findings } from "@shared/draft/mod";
import { api, ApiError } from "~/lib/api";
import type { Draft } from "~/components/initiative-form/types";
import { liveBackers, toPayload } from "~/components/initiative-form/useDraft";

export interface SubmitResult {
  slug: string;
  status: string;
  warnings: Findings["warnings"];
}

export class FindingsError extends Error {
  constructor(message: string, public findings: Findings) {
    super(message);
  }
}

const isFinding = (x: unknown): x is Findings["errors"][number] =>
  Boolean(x && typeof x === "object" && typeof (x as { msg?: unknown }).msg === "string");

/** The findings of a failed request, if the body carries any. */
export function findingsOf(err: unknown): Findings | null {
  if (err instanceof FindingsError) return err.findings;
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const f = (err.body as { findings?: unknown }).findings;
  if (!f || typeof f !== "object") return null;
  const { errors, warnings } = f as { errors?: unknown; warnings?: unknown };
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter(isFinding).map((x) => ({
      field: String(x.field ?? ""),
      msg: x.msg,
      kind: x.kind,
    }));
  return { errors: list(errors), warnings: list(warnings) };
}

export interface UploadedLogo {
  cid: string;
  logoUrl: string;
}

export async function uploadLogo(file: File): Promise<UploadedLogo> {
  const form = new FormData();
  form.append("image", file, file.name);
  return await api<UploadedLogo>("/api/uploads/logo", { form });
}

/**
 * Uploads the logos still missing a receipt (`onLogoCid` lets the form keep
 * the receipt, so a retry after a 400 does not upload again), then posts.
 */
export async function submitInitiative(
  draft: Draft,
  { onLogoCid }: { onLogoCid?: (backerId: string, cid: string) => void } = {},
): Promise<SubmitResult> {
  const cids: Record<string, string> = {};
  const live = liveBackers(draft);
  for (let i = 0; i < live.length; i++) {
    const b = live[i];
    if (!b.logo || b.logoCid) continue;
    try {
      const up = await uploadLogo(b.logo);
      cids[b.id] = up.cid;
      onLogoCid?.(b.id, up.cid);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 503
        ? "Logo uploads are off right now. Remove the file and submit; the review team can add the logo later."
        : err instanceof Error
        ? err.message
        : "The logo could not be uploaded.";
      throw new FindingsError(`${b.org || "Backer " + (i + 1)}: ${msg}`, {
        errors: [{ field: `bk_logo_${i}`, msg, kind: "content" }],
        warnings: [],
      });
    }
  }
  try {
    return await api<SubmitResult>("/api/initiatives", { json: toPayload(draft, cids) });
  } catch (err) {
    const findings = findingsOf(err);
    if (findings && err instanceof ApiError) throw new FindingsError(err.message, findings);
    throw err;
  }
}
