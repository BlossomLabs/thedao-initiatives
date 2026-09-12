import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderUp, Upload } from "lucide-react";
import { Button } from "~/components/ui/Button";
import Status, { type StatusKind } from "~/components/ui/Status";
import { boardKey } from "~/hooks/use-board";
import { api, errorMessage } from "~/lib/api";

interface SyncResult {
  created: number;
  updated: number;
  backers: number;
  errors: string[];
}

/** Files the API's sync accepts: content/rfps/*.md. */
async function readMarkdown(list: FileList | null) {
  const out: { name: string; text: string }[] = [];
  for (const f of Array.from(list ?? [])) {
    const name = f.name;
    if (!name.endsWith(".md") || name === "README.md") continue;
    // README aside, only rfps/<slug>.md is content the API takes (the donation
    // terms are bundled into the site at build time).
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    if (rel && !/(^|\/)rfps\/[^/]+\.md$/.test(rel)) continue;
    out.push({ name, text: await f.text() });
  }
  return out;
}

/**
 * Push the repo's content files from this browser, signed in with the admin
 * wallet: the same POST /api/admin/sync-content the CLI script uses, without
 * a private key on any machine.
 */
export default function SyncContent() {
  const qc = useQueryClient();
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: StatusKind; text: React.ReactNode } | null>(null);

  const send = async (list: FileList | null) => {
    const picked = await readMarkdown(list);
    if (!picked.length) {
      setMsg({
        kind: "err",
        text: "No initiative files found. Pick the content folder or its .md files.",
      });
      return;
    }
    setBusy(true);
    setMsg({
      kind: "wait",
      text: `Syncing ${picked.length} file${picked.length === 1 ? "" : "s"}…`,
    });
    try {
      const r = await api<SyncResult>("/api/admin/sync-content", { json: { files: picked } });
      const summary = `${r.created} created, ${r.updated} updated` +
        (r.backers ? `, ${r.backers} pledge${r.backers === 1 ? "" : "s"} from files` : "");
      setMsg(
        r.errors.length
          ? {
            kind: "err",
            text: (
              <>
                {summary}, {r.errors.length} failed:
                <ul className="m-0 mt-1 pl-5">
                  {r.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </>
            ),
          }
          : { kind: "ok", text: `Content synced: ${summary}.` },
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin"] }),
        qc.invalidateQueries({ queryKey: boardKey }),
      ]);
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
      if (folder.current) folder.current.value = "";
      if (files.current) files.current.value = "";
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
      <div className="min-w-[220px] flex-1">
        <b className="block font-inter-tight text-[14px] font-semibold">Sync content files</b>
        <small className="block text-[12px] text-muted">
          Pick the repo's <span className="mono">content</span>{" "}
          folder (or its markdown files). Files own the words and the goal; status, Safes and money
          stay as they are. The donation terms come along too.
        </small>
      </div>
      <input
        ref={folder}
        type="file"
        hidden
        // @ts-expect-error non-standard but universal: lets the picker select a folder
        webkitdirectory=""
        onChange={(e) => void send(e.target.files)}
      />
      <input
        ref={files}
        type="file"
        hidden
        multiple
        accept=".md,text/markdown"
        onChange={(e) => void send(e.target.files)}
      />
      <div className="flex flex-none gap-2">
        <Button variant="ghost" sm loading={busy} onClick={() => folder.current?.click()}>
          <FolderUp className="size-4" /> Choose folder
        </Button>
        <Button variant="ghost" sm disabled={busy} onClick={() => files.current?.click()}>
          <Upload className="size-4" /> Choose files
        </Button>
      </div>
      {msg && <Status kind={msg.kind} className="basis-full">{msg.text}</Status>}
    </div>
  );
}
