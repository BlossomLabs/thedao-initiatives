import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { When } from "~/components/vote/When";
import { Button } from "~/components/ui/Button";
import Status, { type StatusKind } from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { errorMessage } from "~/lib/api";
import type { AdminStatus, SafeApiKeyInfo } from "~/lib/api-types";
import { shortAddr } from "~/lib/format";
import { cn } from "~/lib/utils";
import { statusKey } from "./queries";
import { DetailSkeleton } from "./TodoSection";

const FIELD =
  "min-w-0 flex-1 rounded-lg border border-edge2 bg-white/5 px-2.5 py-1.5 font-mono text-[13px] text-white outline-none focus:border-[rgba(92,183,90,.6)]";

const keyWords = (k: SafeApiKeyInfo) =>
  k.source === "admin"
    ? `Key set here (…${k.hint})`
    : k.source === "env"
    ? `Default key (…${k.hint})`
    : "No key: 5,000 requests a month unauthenticated";

/**
 * Override the Safe API key without a redeploy. The key is write-only: the
 * status shows its last four characters, never the key.
 */
function SafeApiKeyForm({ info }: { info: SafeApiKeyInfo }) {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string } | null>(null);

  const send = async (value: string) => {
    setBusy(value ? "save" : "clear");
    setMsg(null);
    try {
      await adminApi("/api/admin/safe-api-key", { json: { key: value } });
      await qc.invalidateQueries({ queryKey: statusKey });
      setKey("");
      setMsg({
        kind: "ok",
        text: value
          ? "Saved. The next Safe API request uses this key."
          : info.envConfigured
          ? "Removed. The default key applies again."
          : "Removed. The Safe API is unauthenticated again.",
      });
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="mt-4 rounded-xl border border-edge p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void send(key.trim());
      }}
    >
      <label htmlFor="safe-api-key" className="font-inter-tight text-[14px] font-semibold">
        Safe API key
      </label>
      <p className="m-0 mt-1 small dim">
        {keyWords(info)}
        {info.source === "admin" && info.setBy && info.setAt && (
          <>
            {" · set by "}
            {shortAddr(info.setBy)} <When at={info.setAt} />
          </>
        )}
        {info.source === "admin" && (
          <>
            {" · "}
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2 hover:text-white disabled:opacity-60"
              disabled={busy !== null}
              onClick={() => void send("")}
            >
              {busy === "clear" ? "Removing…" : "Remove"}
            </button>
          </>
        )}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          id="safe-api-key"
          type="password"
          className={FIELD}
          placeholder="Paste a new key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button sm type="submit" loading={busy === "save"} disabled={!key.trim() || busy !== null}>
          Save key
        </Button>
      </div>
      {msg && <Status kind={msg.kind} className="mt-3">{msg.text}</Status>}
    </form>
  );
}

/** Green when every service the admin depends on answers; amber or red names the one that does not. */
export const servicesOk = (s: AdminStatus) => s.safeApi.configured && s.signers.ok;

function Item(
  { ok, title, children }: { ok: boolean; title: string; children: React.ReactNode },
) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-edge p-3.5">
      <span className="flex items-center gap-2 font-inter-tight text-[14px] font-semibold">
        <span
          aria-hidden="true"
          className={cn(
            "size-[9px] flex-none rounded-full",
            ok ? "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]" : "bg-dao-amber",
          )}
        />
        {title}
      </span>
      <span className="small dim">{children}</span>
    </div>
  );
}

/** The Safe API, the chain check and the Safe deploy signers, from saved snapshots. */
export default function Services(
  { data, isLoading, error }: { data?: AdminStatus; isLoading: boolean; error: unknown },
) {
  if (isLoading) return <DetailSkeleton />;
  if (error || !data) {
    return (
      <p className="alert" role="alert">
        The status could not be loaded. {errorMessage(error, "")}
      </p>
    );
  }
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        <Item
          ok={data.safeApi.configured}
          title={`Safe API ${data.safeApi.configured ? "authenticated" : "NOT configured"}`}
        >
          {data.safeApi.key.source === "admin" ? "Key set here · " : ""}Refreshes when viewed after
          {" "}
          {data.safeApi.refreshMinutes} minutes
          {data.safeApi.quota ? ` · ${data.safeApi.quota.remaining} requests left` : ""}
        </Item>
        <Item ok={data.chain.checkedAt > 0} title="Chain">
          {data.chain.detail}
          {data.chain.checkedAt > 0 && (
            <>
              {" · checked "}
              <When at={data.chain.checkedAt} />
            </>
          )}
        </Item>
        <Item
          ok={data.signers.ok}
          title={`Safe deploys ${data.signers.ok ? "enabled" : "disabled"}`}
        >
          {data.signers.detail} · threshold {data.signers.threshold}
        </Item>
      </div>
      <SafeApiKeyForm info={data.safeApi.key} />
    </>
  );
}
