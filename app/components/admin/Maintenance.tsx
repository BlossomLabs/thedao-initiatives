import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileJson, Pause, Play, Upload } from "lucide-react";
import { useAdminApi } from "~/hooks/use-admin-api";
import { sessionKey, useSession } from "~/context/session";
import { privateCacheGeneration } from "~/lib/browser-privacy";
import { boardKey } from "~/hooks/use-board";
import { siteSettingsKey } from "~/hooks/use-site-settings";
import { Button } from "~/components/ui/Button";
import { Input, Label } from "~/components/ui/Field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import Status, { type StatusKind } from "~/components/ui/Status";
import { api, errorMessage } from "~/lib/api";
import type { BackupFile, MaintenanceState, RestoreResult } from "~/lib/api-types";
import { dt } from "~/lib/format";
import { shortAddr } from "~/lib/format";
import { cn } from "~/lib/utils";

const RESTORE_MODES = [
  { value: "merge", label: "Merge (keep existing rows)" },
  { value: "replace", label: "Replace (overwrite existing rows)" },
] as const;

export const maintenanceKey = ["admin", "maintenance"] as const;

// One width for every action, so the buttons form a column down the page.
const ACTION = "w-[220px] max-[640px]:w-full";

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
  // `at` is the action that spoke, so the message shows in that action's panel.
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string; at: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  const run = async (key: string, work: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    const generation = privateCacheGeneration();
    try {
      const done = await work();
      if (generation !== privateCacheGeneration()) return;
      setMsg({ kind: "ok", text: done, at: key });
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e), at: key });
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
  const said = (...keys: string[]) =>
    msg && keys.includes(msg.at) && <Status kind={msg.kind} className="mt-4">{msg.text}</Status>;
  return (
    <>
      <section className="panel mt-5">
        <h2 className="k">Maintenance mode</h2>
        {error && <p className="alert mt-0">{errorMessage(error)}</p>}
        {data && (
          <p className="m-0 flex items-baseline gap-2.5 font-inter-tight text-[14px] leading-[1.6]">
            <span
              className={cn(
                "size-[9px] flex-none translate-y-[-1px] rounded-full",
                on
                  ? "bg-dao-red shadow-[0_0_10px_rgba(255,59,56,.6)]"
                  : "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]",
              )}
              aria-hidden="true"
            />
            <span>
              {on
                ? `Maintenance is on since ${dt(data.at)} (${shortAddr(data.by)})` +
                  (data.note ? `: ${data.note}` : "") +
                  ". Visitors can browse; every change answers 503."
                : "Maintenance is off. Turn it on before restoring a backup or moving the data."}
            </span>
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {!on && (
            <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <Label label="Note for visitors" htmlFor="maintenance-note" />
              <Input
                id="maintenance-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Moving the database, back in a few minutes"
              />
            </div>
          )}
          <Button
            variant={on ? "primary" : "danger"}
            className={ACTION}
            loading={busy === "enter" || busy === "exit"}
            disabled={Boolean(busy) || !data}
            onClick={() => void toggle(!on)}
          >
            {on
              ? (
                <>
                  <Play className="size-4" /> Exit maintenance mode
                </>
              )
              : (
                <>
                  <Pause className="size-4" /> Enter maintenance mode
                </>
              )}
          </Button>
        </div>
        {said("enter", "exit")}
      </section>

      <section className="panel mt-4">
        <h2 className="k">Backup</h2>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="m-0 min-w-[240px] flex-1 small dim">
            The whole database as one JSON file. It holds every record, including private contacts
            and emails: keep it safe.
          </p>
          <Button
            className={ACTION}
            loading={busy === "backup"}
            disabled={Boolean(busy)}
            onClick={() => void download()}
          >
            <Download className="size-4" /> Download backup
          </Button>
        </div>
        {said("backup")}
      </section>

      <section className="panel mt-4">
        <h2 className="k">Restore</h2>
        <p className="m-0 small dim">
          Puts a backup file back. A restore never deletes anything
          {on ? "." : ", and it needs maintenance mode on, so nothing changes underneath."}
        </p>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 max-[860px]:grid-cols-2 max-[640px]:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label label="Backup file" htmlFor="restore-file" />
            <input
              ref={file}
              id="restore-file"
              type="file"
              accept=".json,application/json"
              className="peer sr-only"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
            <label
              htmlFor="restore-file"
              className={cn(
                "field flex cursor-pointer items-center gap-2.5 hover:border-white/30 peer-focus-visible:border-[rgba(92,183,90,.6)]",
                !fileName && "text-white/30",
              )}
            >
              <FileJson className="size-4 flex-none" aria-hidden="true" />
              <span className="min-w-0 truncate">{fileName || "Choose a .json backup"}</span>
            </label>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label label="Mode" htmlFor="restore-mode" />
            <Select
              id="restore-mode"
              items={RESTORE_MODES}
              value={mode}
              onValueChange={(v) => setMode(v as "merge" | "replace")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {RESTORE_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            className={cn(
              ACTION,
              "max-[860px]:col-span-2 max-[860px]:justify-self-end max-[640px]:col-span-1",
            )}
            loading={busy === "restore"}
            disabled={Boolean(busy) || !on}
            title={on ? undefined : "Enter maintenance mode first"}
            onClick={() => void restore()}
          >
            <Upload className="size-4" /> Restore
          </Button>
        </div>
        {said("restore")}
      </section>
    </>
  );
}
