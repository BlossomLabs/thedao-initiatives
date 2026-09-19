import { useAdminApi } from "~/hooks/use-admin-api";
import { sessionKey, useSession } from "~/context/session";
import { privateCacheGeneration } from "~/lib/browser-privacy";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Trash2, UserPlus } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Field";
import Status, { type StatusKind } from "~/components/ui/Status";
import Identity from "~/components/wallet/Identity";
import { api, errorMessage } from "~/lib/api";
import type { AdminList } from "~/lib/api-types";
import { shortAddr } from "~/lib/format";

export const adminsKey = ["admin", "admins"] as const;

/**
 * Who can open this dashboard. Addresses from ADMIN_ADDRESSES are fixed (a
 * lock, no remove button); the rest are added and removed here and take
 * effect on the wallet's next request; newly promoted admins sign in again.
 */
export default function Admins() {
  const adminApi = useAdminApi();
  const { session } = useSession();
  const qc = useQueryClient();
  const queryKey = [...adminsKey, sessionKey(session)];
  const { data, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<AdminList>("/api/admin/admins", { signal }),
    enabled: Boolean(session?.isAdmin),
  });
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string } | null>(null);

  const run = async (key: string, req: () => Promise<AdminList>, done: string) => {
    setBusy(key);
    setMsg(null);
    const generation = privateCacheGeneration();
    try {
      const result = await req();
      if (generation !== privateCacheGeneration()) return;
      qc.setQueryData(queryKey, result);
      setMsg({ kind: "ok", text: done });
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy("");
    }
  };
  const add = () => {
    const a = address.trim();
    if (!a) return;
    void run(
      "add",
      () => adminApi<AdminList>("/api/admin/admins", { json: { address: a } }),
      `${shortAddr(a)} is an admin now.`,
    )
      .then(() => setAddress(""));
  };
  const remove = (a: string) =>
    run(
      a,
      () => adminApi<AdminList>(`/api/admin/admins/${a}`, { method: "DELETE" }),
      `${shortAddr(a)} is no longer an admin.`,
    );

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
      <b className="block font-inter-tight text-[14px] font-semibold">Admins</b>
      <small className="block text-[12px] text-muted">
        Wallets that can open this dashboard. Locked ones come from{" "}
        <span className="mono">ADMIN_ADDRESSES</span>{" "}
        and can only be changed there. Changes apply on the wallet's next request.
      </small>
      {error && <Status kind="err" className="mt-2">{errorMessage(error)}</Status>}
      <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
        {(data?.admins ?? []).map((a) => {
          const you = a.address.toLowerCase() === data?.you.toLowerCase();
          return (
            <li key={a.address} className="flex flex-wrap items-center gap-2">
              <Identity address={a.address} size={18} nameClassName="text-[13px]" />
              {you && <span className="text-[12px] text-muted">(you)</span>}
              {a.fixed
                ? (
                  <span
                    className="inline-flex items-center gap-1 text-[12px] text-muted"
                    title="Set in ADMIN_ADDRESSES"
                  >
                    <Lock className="size-3.5" aria-hidden /> fixed
                  </span>
                )
                : (
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center rounded border-0 bg-transparent p-0.5 text-[#ff9a9a] hover:text-[#ffb3b3] disabled:cursor-default disabled:opacity-40"
                    aria-label={`Remove ${shortAddr(a.address)}`}
                    title={you ? "You cannot remove yourself" : "Remove"}
                    disabled={you || Boolean(busy)}
                    onClick={() => void remove(a.address)}
                  >
                    {busy === a.address
                      ? <Loader2 className="size-4 animate-spin" />
                      : <Trash2 className="size-4" />}
                  </button>
                )}
            </li>
          );
        })}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="Wallet address"
          className="mono h-[38px] min-w-[200px] flex-1 py-0 text-[12.5px]"
          placeholder="0x… wallet to make admin"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={Boolean(busy)}
        />
        <Button
          type="submit"
          variant="ghost"
          sm
          loading={busy === "add"}
          disabled={Boolean(busy) || !address.trim()}
        >
          <UserPlus className="size-4" /> Add admin
        </Button>
      </form>
      {msg && <Status kind={msg.kind} className="mt-2">{msg.text}</Status>}
    </div>
  );
}
