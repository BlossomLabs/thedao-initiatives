import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, Upload } from "lucide-react";
import { useAdminApi } from "~/hooks/use-admin-api";
import { sessionKey, useSession } from "~/context/session";
import { privateCacheGeneration } from "~/lib/browser-privacy";
import { boardKey } from "~/hooks/use-board";
import { siteSettingsKey } from "~/hooks/use-site-settings";
import { Button } from "~/components/ui/Button";
import { Input, Select } from "~/components/ui/Field";
import Status, { type StatusKind } from "~/components/ui/Status";
import { api, errorMessage } from "~/lib/api";
import type { BackupFile, MaintenanceState, RestoreResult } from "~/lib/api-types";
import { dt } from "~/lib/format";
import { shortAddr } from "~/lib/format";

export const maintenanceKey = ["admin", "maintenance"] as const;

/**
 * Pause every write on the site, take the database home as one file, and
 * put a file back. Restoring needs the pause, so nothing changes underneath.
 */
export default function Maintenance() {
  const adminApi = useAdminApi();
  const { session } = useSession();
  const qc = useQueryClient();
  const queryKey = [...maintenanceKey, sessionKey(session)];
  const { data, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<MaintenanceState>("/api/admin/maintenance", { signal }),
    enabled: Boolean(session?.isAdmin),
  });
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (key: string, work: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    const generation = privateCacheGeneration();
    try {
      const done = await work();
      if (generation !== privateCacheGeneration()) return;
      setMsg({ kind: "ok", text: done });
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy("");
    }
  };

  const toggle = (on: boolean) =>
    run(on ? "enter" : "exit", async () => {
      const path = on ? "/api/admin/maintenance/enter" : "/api/admin/maintenance/exit";
      const next = await adminApi<MaintenanceState>(path, {
        json: on ? { note: note.trim() } : {},
      });
      qc.setQueryData(queryKey, next);
      void qc.invalidateQueries({ queryKey: siteSettingsKey });
      return on ? "Maintenance mode is on: every change is paused." : "Maintenance mode is off.";
    });

  const download = () =>
    run("backup", async () => {
      // Through the admin client so a stale session can step up first.
      const backup = await adminApi<BackupFile>("/api/admin/backup", {});
      const stamp = backup.exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thedao-kv-backup-${stamp}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const kinds = Object.values(backup.prefixes).filter((n) => n > 0).length;
      return `Backup saved: ${backup.entries.length} entries across ${kinds} record types.`;
    });

  const restore = () =>
    run("restore", async () => {
      const chosen = file.current?.files?.[0];
      if (!chosen) throw new Error("Choose a backup file first.");
      let backup: BackupFile;
      try {
        backup = JSON.parse(await chosen.text());
        if (backup?.format !== "thedao-kv-backup/1") throw new Error();
      } catch {
        throw new Error("That is not a backup file.");
      }
      const result = await adminApi<RestoreResult>("/api/admin/restore", {
        json: { mode, backup },
      });
      void qc.invalidateQueries({ queryKey: ["admin"] });
      void qc.invalidateQueries({ queryKey: boardKey });
      return `Restored (${mode}): ${result.written} written, ${result.skipped} skipped, ${result.claimsRebuilt} comment claims rebuilt.`;
    });

  const on = data?.on ?? false;
  return (
    <div className="mt-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
      <b className="block font-inter-tight text-[14px] font-semibold">Maintenance and backups</b>
      {error && <p className="alert mt-2">{errorMessage(error)}</p>}
      {data && (
        <p className="m-0 mt-1 small">
          <span
            className={"mr-2 inline-block size-2 rounded-full align-middle " +
              (on ? "bg-amber-400" : "bg-dao-green")}
            aria-hidden="true"
          />
          {on
            ? `Maintenance is on since ${dt(data.at)} (${shortAddr(data.by)})` +
              (data.note ? `: ${data.note}` : "") +
              ". Visitors can browse; every change answers 503."
            : "Maintenance is off. Turn it on before restoring a backup or moving the data."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {!on && (
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 small">
            Note for visitors
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Moving the database, back in a few minutes"
            />
          </label>
        )}
        <Button
          variant={on ? "primary" : "danger"}
          sm
          loading={busy === "enter" || busy === "exit"}
          disabled={Boolean(busy) || !data}
          onClick={() => void toggle(!on)}
        >
          {on
            ? (
              <>
                <Play className="size-3.5" /> Exit maintenance mode
              </>
            )
            : (
              <>
                <Pause className="size-3.5" /> Enter maintenance mode
              </>
            )}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-white/[.08] pt-3">
        <Button
          variant="ghost"
          sm
          loading={busy === "backup"}
          disabled={Boolean(busy)}
          onClick={() => void download()}
        >
          <Download className="size-3.5" /> Download backup
        </Button>
        <label className="flex flex-col gap-1 small">
          Backup file
          <input ref={file} type="file" accept=".json,application/json" className="text-[13px]" />
        </label>
        <label className="flex flex-col gap-1 small">
          Mode
          <Select value={mode} onChange={(e) => setMode(e.target.value as "merge" | "replace")}>
            <option value="merge">merge (keep existing rows)</option>
            <option value="replace">replace (overwrite existing rows)</option>
          </Select>
        </label>
        <Button
          variant="ghost"
          sm
          loading={busy === "restore"}
          disabled={Boolean(busy) || !on}
          title={on ? undefined : "Enter maintenance mode first"}
          onClick={() => void restore()}
        >
          <Upload className="size-3.5" /> Restore
        </Button>
        <p className="m-0 basis-full small dim">
          The file holds every record, including private contacts and emails: keep it safe. A
          restore never deletes anything.
        </p>
        {msg && <Status kind={msg.kind} className="basis-full">{msg.text}</Status>}
      </div>
    </div>
  );
}
