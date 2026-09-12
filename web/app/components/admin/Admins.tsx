import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, UserPlus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Field";
import Status, { type StatusKind } from "~/components/ui/Status";
import { api, errorMessage } from "~/lib/api";
import type { AdminList } from "~/lib/api-types";
import { shortAddr } from "~/lib/format";

export const adminsKey = ["admin", "admins"] as const;

/**
 * Who can open this dashboard. Addresses from ADMIN_ADDRESSES are fixed (a
 * lock, no remove button); the rest are added and removed here and take
 * effect on the wallet's next request, no new sign-in needed.
 */
export default function Admins() {
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: adminsKey,
    queryFn: () => api<AdminList>("/api/admin/admins"),
  });
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string } | null>(null);

  const run = async (key: string, req: () => Promise<AdminList>, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      qc.setQueryData(adminsKey, await req());
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
    void run("add", () => api<AdminList>("/api/admin/admins", { json: { address: a } }), `${shortAddr(a)} is an admin now.`)
      .then(() => setAddress(""));
  };
  const remove = (a: string) =>
    run(a, () => api<AdminList>(`/api/admin/admins/${a}`, { method: "DELETE" }), `${shortAddr(a)} is no longer an admin.`);

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
              <span className="mono text-[12.5px]" title={a.address}>
                {shortAddr(a.address)}
              </span>
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
                  <Button
                    variant="ghost"
                    sm
                    aria-label={`Remove ${shortAddr(a.address)}`}
                    title={you ? "You cannot remove yourself" : "Remove"}
                    disabled={you || Boolean(busy)}
                    loading={busy === a.address}
                    onClick={() => void remove(a.address)}
                  >
                    <X className="size-4" />
                  </Button>
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
          className="mono min-w-[200px] flex-1 text-[12.5px]"
          placeholder="0x… wallet to make admin"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={Boolean(busy)}
        />
        <Button type="submit" variant="ghost" sm loading={busy === "add"} disabled={Boolean(busy) || !address.trim()}>
          <UserPlus className="size-4" /> Add admin
        </Button>
      </form>
      {msg && <Status kind={msg.kind} className="mt-2">{msg.text}</Status>}
    </div>
  );
}
