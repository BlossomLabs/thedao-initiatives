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

/** What the sync takes: content/rfps/*.md, and content/logos/* for backer logos. */
async function readContent(list: FileList | null) {
  const files: { name: string; text: string }[] = [];
  const logos: File[] = [];
  for (const f of Array.from(list ?? [])) {
    const name = f.name;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    if (/\.(png|jpe?g|webp)$/i.test(name) && (!rel || /(^|\/)logos\/[^/]+$/.test(rel))) {
      logos.push(f);
      continue;
    }
    if (!name.endsWith(".md") || name === "README.md") continue;
    // README aside, only rfps/<slug>.md is content the API takes (the donation
    // terms are bundled into the site at build time).
    if (rel && !/(^|\/)rfps\/[^/]+\.md$/.test(rel)) continue;
    files.push({ name, text: await f.text() });
  }
  return { files, logos };
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
    const { files: picked, logos } = await readContent(list);
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
      // Logos first, so the backers lines can name them.
      for (const logo of logos) {
        const form = new FormData();
        form.set("name", logo.name.toLowerCase());
        form.set("image", logo);
        await api("/api/admin/logos", { form });
      }
      const r = await api<SyncResult>("/api/admin/sync-content", { json: { files: picked } });
      const summary = `${r.created} created, ${r.updated} updated` +
        (r.backers ? `, ${r.backers} pledge${r.backers === 1 ? "" : "s"} from files` : "") +
        (logos.length ? `, ${logos.length} logo${logos.length === 1 ? "" : "s"}` : "");
      // A file naming a logo that is not pinned: the pick did not carry the
      // image, so say where it lives rather than only relaying the server.
      const logoMissing = !logos.length && r.errors.some((e) => e.includes("is not uploaded yet"));
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
                {logoMissing && (
                  <p className="m-0 mt-2">
                    No logo files were in this pick. Choose the whole{" "}
                    <span className="mono">content</span> folder, or its{" "}
                    <span className="mono">logos</span>{" "}
                    folder on its own, then sync the files again: pinned logos stay.
                  </p>
                )}
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
          stay as they are. Backer logos in <span className="mono">content/logos</span>{" "}
          are pinned to IPFS on the way.
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
        accept=".md,text/markdown,.png,.jpg,.jpeg,.webp"
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
