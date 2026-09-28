import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoteSettings as Settings } from "@shared/vote";
import { Button } from "~/components/ui/Button";
import { Field, Input } from "~/components/ui/Field";
import Status from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { api, errorMessage } from "~/lib/api";
import { boardKey } from "~/hooks/use-board";

const key = ["admin", "vote-settings"] as const;

/** The vote-eligibility display: off until the copy is final; floor and cap without a deploy. */
export default function VoteSettings() {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<Settings>("/api/admin/vote-settings", { signal }),
  });
  const [form, setForm] = useState({ show: false, floorPct: "25", capUsd: "200000" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) {
      setForm({ show: data.show, floorPct: String(data.floorPct), capUsd: String(data.capUsd) });
    }
  }, [data]);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi("/api/admin/vote-settings", {
        json: { show: form.show, floorPct: Number(form.floorPct), capUsd: Number(form.capUsd) },
      });
      setMsg({ ok: true, text: "Saved. The board shows it within a minute." });
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: boardKey });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, "Not saved.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel mt-3.5">
      <span className="k">Vote eligibility on the board</span>
      <label className="flex cursor-pointer items-center gap-2.5 font-inter-tight text-[14px]">
        <input
          type="checkbox"
          checked={form.show}
          onChange={(e) => setForm((f) => ({ ...f, show: e.target.checked }))}
        />
        Show the vote floor tick and eligibility on cards and list rows
      </label>
      <div className="grid grid-cols-2 gap-x-4 max-[640px]:grid-cols-1">
        <Field label="Vote floor (% of goal raised)" htmlFor="v-floor">
          <Input
            id="v-floor"
            inputMode="decimal"
            value={form.floorPct}
            onChange={(e) => setForm((f) => ({ ...f, floorPct: e.target.value }))}
          />
        </Field>
        <Field label="Cap on the remaining gap (USD)" htmlFor="v-cap">
          <Input
            id="v-cap"
            inputMode="numeric"
            value={form.capUsd}
            onChange={(e) => setForm((f) => ({ ...f, capUsd: e.target.value }))}
          />
        </Field>
      </div>
      <div className="mt-3.5 flex items-center gap-3">
        <Button sm loading={busy} onClick={() => void save()}>Save</Button>
        {msg && <Status kind={msg.ok ? "ok" : "err"}>{msg.text}</Status>}
      </div>
    </div>
  );
}
