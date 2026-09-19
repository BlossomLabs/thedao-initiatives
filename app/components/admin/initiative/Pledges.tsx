import { useEffect, useRef, useState } from "react";
import { PencilLine, Trash2, Upload } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { api } from "~/lib/api";
import type { AdminInitiativePage, Pledge } from "~/lib/api-types";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { Run } from "./run";

/** Add or edit a pledge: the same fields either way; a new logo replaces the old one. */
function PledgeForm(
  { base, run, editing, onDone }: {
    base: string;
    run: Run;
    editing: Pledge | null;
    onDone: () => void;
  },
) {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [logoName, setLogoName] = useState("");
  // Controlled: form.reset() does not reach the custom select.
  const [status, setStatus] = useState(editing?.status ?? "pledged");
  useEffect(() => {
    ref.current?.reset();
    setLogoName("");
    setStatus(editing?.status ?? "pledged");
  }, [editing?.id]);
  return (
    <form
      ref={ref}
      className="panel"
      // The server's answer renders under the form; the browser's own bubble would not match the site.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        const req = editing
          ? api(`${base}/pledges/${editing.id}`, { method: "PATCH", form })
          : api(`${base}/pledges`, { form });
        run(() => req, editing ? "Pledge updated." : "Pledge added.")
          .then((saved) => {
            // A refused pledge keeps what was typed.
            if (!saved) return;
            ref.current?.reset();
            setLogoName("");
            setStatus("pledged");
            onDone();
          })
          .finally(() => setBusy(false));
      }}
    >
      <span className="k">
        {editing ? `Edit the pledge from ${editing.company}` : "Add a pledge"}
      </span>
      <div className="grid grid-cols-[1fr_140px_130px] gap-2.5 max-[640px]:grid-cols-1">
        <Input
          name="company"
          placeholder="Company *"
          maxLength={120}
          required
          defaultValue={editing?.company ?? ""}
        />
        <Input
          name="amount"
          placeholder="Amount USD *"
          inputMode="decimal"
          required
          defaultValue={editing ? String(editing.amountUsd) : ""}
        />
        <Select name="status" value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="pledged">pledged</SelectItem>
              <SelectItem value="received">received</SelectItem>
              {editing && <SelectItem value="withdrawn">withdrawn</SelectItem>}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 max-[640px]:grid-cols-1">
        <Input
          name="url"
          placeholder="Link (optional)"
          maxLength={300}
          defaultValue={editing?.url ?? ""}
        />
        <Input
          name="note"
          placeholder="Note (optional)"
          maxLength={300}
          defaultValue={editing?.note ?? ""}
        />
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <Button type="submit" sm loading={busy}>{editing ? "Save pledge" : "Add pledge"}</Button>
        {editing && <Button type="button" sm variant="ghost" onClick={onDone}>Cancel</Button>}
        <label className="btn btn-ghost btn-sm cursor-pointer">
          <Upload className="size-3.5" />
          {logoName || (editing?.logoUrl ? "Replace logo" : "Logo (optional)")}
          <input
            type="file"
            name="logo"
            accept=".png,.jpg,.jpeg,.webp"
            className="sr-only"
            onChange={(e) => setLogoName(e.target.files?.[0]?.name ?? "")}
          />
        </label>
        {editing?.logoUrl && !logoName && (
          <img src={editing.logoUrl} alt="" className="h-6 rounded bg-white p-0.5" />
        )}
        <span className="small dim">PNG, JPG or WEBP; shown on the public page.</span>
      </div>
    </form>
  );
}

export default function Pledges(
  { page, base, run }: { page: AdminInitiativePage; base: string; run: Run },
) {
  const [editing, setEditing] = useState<Pledge | null>(null);
  return (
    <>
      {page.pledges.length > 0 && (
        <div className="tblbox mb-3.5">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th className="amt">Amount</th>
                <th>Status</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {page.pledges.map((p) => (
                <tr
                  key={p.id}
                  className={cn(editing?.id === p.id && "[&>td]:bg-[rgba(92,183,90,.08)]")}
                >
                  <td>
                    {p.logoUrl && (
                      <img
                        src={p.logoUrl}
                        alt=""
                        className="mr-2 inline h-6 rounded bg-white p-0.5 align-middle"
                      />
                    )}
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noopener">{p.company}</a>
                      : p.company}
                  </td>
                  <td className="amt">{usd(p.amountUsd)}</td>
                  <td>
                    <Select
                      value={p.status}
                      onValueChange={(status) =>
                        run(() =>
                          api(`${base}/pledges/${p.id}`, {
                            method: "PATCH",
                            json: { status },
                          })
                        )}
                    >
                      <SelectTrigger size="sm" aria-label={`Status of ${p.company}'s pledge`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {["pledged", "received", "withdrawn"].map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="small dim">{p.note}</td>
                  <td className="whitespace-nowrap text-right">
                    <button
                      type="button"
                      className="cursor-pointer rounded-[9px] border border-transparent bg-transparent p-1.5 text-muted hover:border-[rgba(92,183,90,.5)] hover:text-dao-green"
                      title="Edit pledge"
                      onClick={() => setEditing(p)}
                    >
                      <PencilLine className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded-[9px] border border-transparent bg-transparent p-1.5 text-[#ffb3b1] hover:border-[rgba(255,59,56,.6)]"
                      title="Delete pledge"
                      onClick={() =>
                        confirm(`Delete the pledge from ${p.company}?`) &&
                        run(
                          () => api(`${base}/pledges/${p.id}`, { method: "DELETE" }),
                          "Pledge deleted.",
                        )}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PledgeForm base={base} run={run} editing={editing} onDone={() => setEditing(null)} />
    </>
  );
}
