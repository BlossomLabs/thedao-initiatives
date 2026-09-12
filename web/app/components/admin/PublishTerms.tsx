import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Button } from "~/components/ui/Button";
import Status, { type StatusKind } from "~/components/ui/Status";
import SectionHeading from "~/components/layout/SectionHeading";
import { formatEffective, useTerms, useTermsVersions } from "~/hooks/use-terms";
import { api, errorMessage } from "~/lib/api";

interface PublishResult {
  outcome: "published" | "existing";
  version: { id: string; effectiveDate: string; material: boolean; publishedAt: number };
}

/** The `version: YYYY-MM-DD` line of content/donation-terms.md is the effective date. */
function splitTermsFile(raw: string): { effectiveDate: string; text: string } {
  const m = /^version:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*\r?\n/i.exec(raw);
  return m
    ? { effectiveDate: m[1], text: raw.slice(m[0].length).trim() }
    : { effectiveDate: "", text: raw.trim() };
}

/**
 * Publish a new version of the donation terms. Every version is kept under its
 * content hash and never overwritten; the newest published one is in force.
 */
export default function PublishTerms() {
  const qc = useQueryClient();
  const { data: current } = useTerms();
  const { data: list } = useTermsVersions();
  const [text, setText] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [material, setMaterial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: StatusKind; text: string } | null>(null);

  const load = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    const parsed = splitTermsFile(await f.text());
    setText(parsed.text);
    if (parsed.effectiveDate) setEffectiveDate(parsed.effectiveDate);
  };

  const publish = async () => {
    if (text.trim().length < 200) {
      setStatus({ kind: "err", text: "Paste or load the full terms text first." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setStatus({ kind: "err", text: "Pick the effective date." });
      return;
    }
    if (
      !confirm(
        `Publish these terms effective ${formatEffective(effectiveDate)}${
          material ? " as a MATERIAL change (30-day notice on the site)" : ""
        }? Earlier versions stay published; this cannot be edited afterwards.`,
      )
    ) return;
    setBusy(true);
    setStatus({ kind: "wait", text: "Publishing…" });
    try {
      const r = await api<PublishResult>("/api/admin/terms", {
        json: { text: text.trim(), effectiveDate, material },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["terms"] }),
        qc.invalidateQueries({ queryKey: ["terms-versions"] }),
      ]);
      setStatus({
        kind: "ok",
        text: r.outcome === "published"
          ? `Published version ${r.version.id.slice(0, 12)}, effective ${
            formatEffective(r.version.effectiveDate)
          }. It is now the version in force.`
          : `That exact text with that date was already published (version ${
            r.version.id.slice(0, 12)
          }); it is the version in force again.`,
      });
      setText("");
      setMaterial(false);
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeading id="donation-terms">Donation terms</SectionHeading>
      <p className="m-0 small dim">
        In force: {current
          ? (
            <>
              effective {formatEffective(current.effectiveDate)}, version{" "}
              <span className="mono">{current.id.slice(0, 12)}</span>
              {current.fromBundle ? " (bundled file, nothing published yet)" : ""}
              {current.material ? ", material change" : ""}
            </>
          )
          : "loading…"}
        {list?.versions.length ? ` · ${list.versions.length} published version(s)` : ""}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex flex-wrap items-center gap-3 small">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="size-[15px]" /> Load content/donation-terms.md
          </span>
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            className="small"
            onChange={(e) => void load(e.target.files)}
          />
        </label>
        <textarea
          className="field mono min-h-[180px] text-[12px]"
          placeholder="…or paste the full terms text (markdown, without the version line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 small">
            Effective date
            <input
              type="date"
              className="field py-1.5"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 small">
            <input
              type="checkbox"
              className="size-4"
              checked={material}
              onChange={(e) => setMaterial(e.target.checked)}
            />
            Material change (shows the notice on the terms page and under the widget for 30 days)
          </label>
          <Button sm variant="primary" loading={busy} onClick={publish}>
            Publish version
          </Button>
        </div>
        {status && <Status kind={status.kind}>{status.text}</Status>}
      </div>
    </>
  );
}
