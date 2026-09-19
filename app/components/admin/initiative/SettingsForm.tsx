import { useEffect, useState } from "react";
import { Button } from "~/components/ui/Button";
import { Field, Input } from "~/components/ui/Field";
import { useAdminApi } from "~/hooks/use-admin-api";
import type { AdminInitiative } from "~/lib/api-types";
import type { Run } from "./run";

/** Two fields side by side on shared grid rows, so the inputs line up when one hint wraps
 * (the pairs of the initiative form's PageFields do the same). */
const PAIR = "grid grid-cols-[1fr_1fr] gap-x-4 max-[640px]:grid-cols-1";
const PAIRED = "row-span-2 grid grid-rows-subgrid first:mt-[18px]";

const settingsOf = (r: AdminInitiative) => ({
  proposer: r.proposer,
  sortRank: r.sortRank ? String(r.sortRank) : "",
  paidOutUsd: r.paidOutUsd ? String(r.paidOutUsd) : "",
});

/**
 * What only the team sets: owner, board pin and paid out. Only the fields
 * that changed are sent, so the wallet is asked to sign again only for the
 * two that need it (owner, paid out).
 */
export default function SettingsForm({ r, run }: { r: AdminInitiative; run: Run }) {
  const adminApi = useAdminApi();
  const [saved, setSaved] = useState(() => settingsOf(r));
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const next = settingsOf(r);
    setSaved(next);
    setForm(next);
  }, [r.proposer, r.sortRank, r.paidOutUsd]);
  const keys = Object.keys(saved) as (keyof typeof saved)[];
  const changed = Object.fromEntries(
    keys.filter((k) => form[k].trim() !== saved[k]).map((k) => [k, form[k].trim()]),
  );
  const dirty = Object.keys(changed).length > 0;
  const set = (k: keyof typeof saved) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form
      className="panel"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || busy) return;
        setBusy(true);
        void run(
          () => adminApi(`/api/admin/initiatives/${r.id}`, { method: "PATCH", json: changed }),
          "Settings saved.",
        ).finally(() => setBusy(false));
      }}
    >
      <Field
        label="Owner"
        htmlFor="s-owner"
        hint="Wallet address or ENS name. Shown publicly as “Proposed by”, and the wallet that can edit the initiative; blank to hide."
      >
        <Input
          id="s-owner"
          maxLength={100}
          placeholder="0x… or name.eth"
          className="mono"
          value={form.proposer}
          onChange={set("proposer")}
        />
      </Field>
      <div className={PAIR}>
        <Field
          label="Pin to board position"
          htmlFor="s-pin"
          hint="1 = top; blank = sort by money raised."
          className={PAIRED}
        >
          <Input
            id="s-pin"
            inputMode="numeric"
            placeholder="Not pinned"
            value={form.sortRank}
            onChange={set("sortRank")}
          />
        </Field>
        <Field
          label="Paid out to the team (USD)"
          htmlFor="s-paid"
          hint="“Raised” is the Safe's balance plus this, so a milestone payment does not lower it."
          className={PAIRED}
        >
          <Input
            id="s-paid"
            inputMode="decimal"
            placeholder="0"
            value={form.paidOutUsd}
            onChange={set("paidOutUsd")}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" sm loading={busy} disabled={!dirty}>Save settings</Button>
        {r.contact && (
          <span className="small dim">
            Contact, private: <span className="text-soft">{r.contact}</span>
          </span>
        )}
      </div>
    </form>
  );
}
