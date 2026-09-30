import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoteSettings as Settings } from "@shared/vote";
import { Button } from "~/components/ui/Button";
import { Field, Input } from "~/components/ui/Field";
import Status from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { api, errorMessage } from "~/lib/api";
import { boardKey } from "~/hooks/use-board";
import { siteSettingsKey } from "~/hooks/use-site-settings";

const key = ["admin", "vote-settings"] as const;

/** Vote eligibility: off until the copy is final; the floor and the cap change without a deploy. */
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
      setMsg({ ok: true, text: "Saved. The board and initiative pages show it within a minute." });
      for (const k of [key, boardKey, siteSettingsKey]) void qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, "Not saved.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel mt-3.5" aria-labelledby="vote-settings">
      <span className="k" id="vote-settings">Vote eligibility</span>
      <label className="flex cursor-pointer items-start gap-2.5 font-inter-tight text-[14px]">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.show}
          onChange={(e) => setForm((f) => ({ ...f, show: e.target.checked }))}
        />
        <span>
          Show it on the board and initiative pages
          <small className="block text-[12px] text-muted">
            The floor is shown as the "first goal": a mark on each funding bar, the First goal
            reached filter, and a line on each initiative page saying how far it is.
          </small>
        </span>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-x-4 max-[640px]:grid-cols-1">
        <Field label="Vote floor (% of the goal raised)" htmlFor="v-floor">
          <Input
            id="v-floor"
            inputMode="decimal"
            value={form.floorPct}
            onChange={(e) => setForm((f) => ({ ...f, floorPct: e.target.value }))}
          />
        </Field>
        <Field label="Most TheDAO tops up (USD)" htmlFor="v-cap">
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
    </section>
  );
}
