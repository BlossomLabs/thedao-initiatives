/**
 * One backer: organization, amount, link and the logo file, with a chip that
 * shows how the row renders on the page (the Backers list and the board card).
 */
import { useEffect, useMemo, useRef } from "react";
import { ImagePlus } from "lucide-react";
import { LIMITS, parseAmount, usd } from "@shared/draft/mod";
import { Button } from "~/components/ui/Button";
import BackerLogo from "~/components/ui/BackerLogo";
import { Input } from "~/components/ui/Field";
import AmountInput from "./AmountInput";
import { domId, FieldMsg, useFinding } from "./findings";
import FormField from "./FormField";
import type { DraftBacker } from "./types";
import type { DraftActions } from "./useDraft";

export const LOGO_HELP =
  "Upload the organization's official logo file (from their press kit, brand page, or repository). PNG, JPG or WEBP under 1 MB. Never a redrawn or AI-made version.";

/** An object URL for a chosen file, revoked when it changes. */
export function useObjectUrl(file: File | null): string {
  const url = useMemo(
    () => (file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : ""),
    [file],
  );
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

export default function BackerRow(
  { b, n, idx, actions, uploads, disabled }: {
    b: DraftBacker;
    /** Position in the list, for the "Backer n" label. */
    n: number;
    /** Index in the finding ids (bk_org_<idx>): the live-row index, or "e<i>" for an empty row. */
    idx: string;
    actions: DraftActions;
    /** Whether the API accepts logo uploads right now. */
    uploads: boolean;
    disabled?: boolean;
  },
) {
  const logoField = `bk_logo_${idx}`;
  const lf = useFinding(logoField);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoUrl = useObjectUrl(b.logo);
  const amount = parseAmount(b.amount);
  return (
    <li className="rounded-2xl border border-edge bg-card px-5 py-4" data-field={`bk_${idx}`}>
      <div className="flex items-center gap-3">
        <span className="k m-0 flex-1">Backer {n}</span>
        <Button variant="ghost" sm disabled={disabled} onClick={() => actions.removeBacker(b.id)}>
          Remove
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_200px] gap-x-4 max-[640px]:grid-cols-1">
        <FormField field={`bk_org_${idx}`} label="Organization" className="mt-3.5 first:mt-3.5">
          <Input
            maxLength={LIMITS.BACKER_ORG + 1}
            placeholder="Who committed the money"
            value={b.org}
            disabled={disabled}
            onChange={(e) => actions.setBacker(b.id, { org: e.target.value })}
          />
        </FormField>
        <FormField
          field={`bk_amount_${idx}`}
          label="Amount committed (USD)"
          className="mt-3.5 first:mt-3.5"
        >
          {(props) => (
            <AmountInput
              {...props}
              placeholder="20,000"
              value={b.amount}
              disabled={disabled}
              onChange={(v) => actions.setBacker(b.id, { amount: v })}
            />
          )}
        </FormField>
      </div>
      <FormField field={`bk_url_${idx}`} label="Link" className="mt-1">
        <Input
          type="url"
          placeholder="https://"
          maxLength={LIMITS.BACKER_URL + 1}
          value={b.url}
          disabled={disabled}
          onChange={(e) => actions.setBacker(b.id, { url: e.target.value })}
        />
      </FormField>
      <div className="mt-[18px]" data-field={logoField}>
        <span className="label">Logo file</span>
        <span className="hint">{LOGO_HELP}</span>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            id={domId(logoField)}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={disabled || !uploads}
            onChange={(e) => actions.setLogo(b.id, e.target.files?.[0] ?? null)}
          />
          <Button
            variant="ghost"
            sm
            disabled={disabled || !uploads}
            aria-invalid={lf.errors.length ? true : undefined}
            className={lf.errors.length ? "border-[rgba(255,59,56,.7)]" : undefined}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3.5" />
            {b.logo ? "Change the logo" : "Choose a logo file"}
          </Button>
          {b.logo && (
            <span className="small dim [overflow-wrap:anywhere]">
              {b.logo.name}
              <button
                type="button"
                className="ml-2 cursor-pointer border-0 bg-transparent p-0 text-dao-green hover:underline"
                onClick={() => {
                  actions.setLogo(b.id, null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                remove
              </button>
            </span>
          )}
          {!uploads && (
            <span className="small dim">
              Logo uploads are off right now; the review team can add one later.
            </span>
          )}
        </div>
        <FieldMsg field={logoField} />
      </div>
      {(b.org.trim() || b.logo) && (
        <div className="mt-4">
          <span className="eyebrow">On the page it looks like this</span>
          <div className="mt-2 inline-flex items-center gap-3 rounded-[14px] border border-edge2 bg-card px-4 py-2.5">
            <BackerLogo logoUrl={logoUrl} company={b.org || "Backer"} className="flex-none" />
            <div>
              <b className="mr-2 font-inter-tight text-[14px] font-semibold">
                {b.org.trim() || "Unnamed backer"}
              </b>
              <span className="mono text-[13px] text-dao-green">{usd(amount)}</span>
              <small className="ml-2 inline-block text-[11px] uppercase tracking-[.08em] text-muted">
                pledged
              </small>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
