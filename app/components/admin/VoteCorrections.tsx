import { useVoteApi, useVoteEnvironment } from "~/lib/vote-round";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { errorMessage } from "~/lib/api";
import { dayTime } from "~/lib/format";
import { addingOpen, type CorrectionView } from "../../../shared/vote/corrections";

const FIELD =
  "mt-1 block w-full rounded-lg border border-edge2 bg-white/5 px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-dao-green disabled:opacity-50";
const ZERO = "0x0000000000000000000000000000000000000000";
const usd = (value: string) => formatUnits(BigInt(value), 6);
const localDate = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-[12px] text-muted">{label}{children}</label>
);
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <details className="border-t border-edge py-3">
    <summary className="cursor-pointer text-[14px] font-semibold">{title}</summary>
    <div className="mt-3 space-y-3">{children}</div>
  </details>
);

export default function VoteCorrections() {
  const env = useVoteEnvironment();
  const api = useVoteApi();
  const { data, error } = useQuery({
    queryKey: [env, "admin", "vote-corrections"],
    queryFn: ({ signal }) => api<CorrectionView>("/api/admin/vote-round/corrections", { signal }),
    refetchInterval: 10_000,
  });
  return (
    <section
      className="rounded-2xl border border-edge bg-card px-[18px] py-4"
      aria-label="Correct round settings"
    >
      <h2 className="font-inter-tight text-[14px] font-semibold">Correct round settings</h2>
      <p className="mt-1 mb-3 text-[12px] text-muted">
        Review a correction, then download it for the admin Safe. Settings refresh after execution.
        Earlier ballots and settled awards keep their history.
      </p>
      {error && <Status kind="err">{errorMessage(error)}</Status>}
      {data?.supported
        ? (
          <Editor
            key={`${data.manifest.chainId}:${data.manifest.contract}:${data.manifest.configRevision}:${data.manifest.configAnchor?.hash}`}
            view={data}
          />
        )
        : data && (
          <p className="text-[12px] text-muted">
            This round's contract predates these correction controls.
          </p>
        )}
    </section>
  );
}

function Editor({ view: v }: { view: CorrectionView }) {
  const m = v.manifest;
  const adminApi = useAdminApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ summary: string; batch: unknown } | null>(null);
  const request = useRef(0);
  const clearReview = () => {
    request.current++;
    setReview(null);
  };
  useEffect(clearReview, [v.poolUpdateNonce, v.poolUsd, v.pendingPoolUsd]);
  const [selected, setSelected] = useState(0);
  const [currency, setCurrency] = useState(1);
  const setup = v.now < m.opensAt;
  const canAdd = addingOpen(m, v.now) && !v.final;
  const prepare = async (values: Record<string, unknown>) => {
    const current = ++request.current;
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      const prepared = await adminApi<{ summary: string; batch: unknown }>(
        "/api/admin/vote-round/corrections",
        { json: { ...values, revision: m.configRevision } },
      );
      if (current === request.current) setReview(prepared);
    } catch (e) {
      if (current === request.current) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const submit =
    (action: string, extra: (f: FormData) => Record<string, unknown> = () => ({})) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const values = { ...Object.fromEntries(f), ...extra(f), action };
      for (const k of ["opening", "tally0", "tally1", "tally2", "group"]) {
        delete (values as Record<string, unknown>)[k];
      }
      void prepare(values);
    };
  const save = () => {
    if (!review) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(review.batch, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${m.kind === "real" ? "" : "test-"}vote-correction.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const reviewButton = (disabled = false) => (
    <Button sm type="submit" disabled={disabled || busy}>Review change</Button>
  );
  return (
    <div onChange={clearReview}>
      {m.slugs.length > 0 && (
        <Section title="Initiative details">
          <Field label="Initiative">
            <select
              className={FIELD}
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {m.slugs.map((slug, i) => (
                <option key={i} value={i}>{slug}{v.settled.includes(i) ? " · settled" : ""}</option>
              ))}
            </select>
          </Field>
          {!canAdd && (
            <p className="text-[12px] text-muted">
              Corrections open outside the scheduled quiet-ending spans, before the round ends.
            </p>
          )}
          {v.settled.includes(selected) && (
            <p className="text-[12px] text-muted">
              This initiative has settled and cannot be corrected here.
            </p>
          )}
          <InitiativeFields
            key={selected}
            view={v}
            id={selected}
            disabled={!canAdd || v.settled.includes(selected)}
            submit={submit}
            button={reviewButton}
          />
        </Section>
      )}
      <Section title="Pool funding">
        <p className="text-[13px]">Active pool: ${usd(v.poolUsd)}</p>
        <form className="space-y-3" onSubmit={submit("pool")}>
          <Field label="Total pool in dollars">
            <input
              className={FIELD}
              name="amountUsd"
              inputMode="decimal"
              defaultValue={usd(v.poolUsd)}
              required
            />
          </Field>
          <p className="text-[12px] text-muted">
            {v.now < m.schedule.firstTallyAt[0]
              ? "The pool can be corrected in either direction before S-Tier's first tally."
              : "Increases are proposed first. Review the pending amount after execution, then activate it in a separate transaction."}
          </p>
          {reviewButton(v.final || v.now >= m.closesAt)}
        </form>
        {v.pendingPoolUsd !== null && (
          <div className="rounded-lg border border-dao-green/30 p-3">
            <p className="mb-2 text-[13px]">Pending total: ${usd(v.pendingPoolUsd)}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                sm
                disabled={busy || v.final || v.now >= m.closesAt}
                onClick={() => void prepare({ action: "activatePool", nonce: v.poolUpdateNonce })}
              >
                Review activation
              </Button>
              <Button
                sm
                variant="ghost"
                disabled={busy}
                onClick={() => void prepare({ action: "cancelPool", nonce: v.poolUpdateNonce })}
              >
                Review cancellation
              </Button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Dates and windows">
        <form
          className="space-y-3"
          onSubmit={submit("schedule", (f) => ({
            opensAt: String(
              f.get("opening") === localDate(m.opensAt)
                ? m.opensAt
                : Math.floor(new Date(String(f.get("opening"))).getTime() / 1000),
            ),
            firstTallyAt: [0, 1, 2].map((i) =>
              f.get(`tally${i}`) === localDate(m.schedule.firstTallyAt[i])
                ? m.schedule.firstTallyAt[i]
                : Math.floor(new Date(String(f.get(`tally${i}`))).getTime() / 1000)
            ),
          }))}
        >
          <p className="text-[12px] text-muted">
            Opening:{" "}
            {dayTime(m.opensAt)}. Window lengths freeze at opening; only future tally dates can
            change afterwards.
          </p>
          <Field label="Voting opens">
            <input
              className={FIELD}
              type="datetime-local"
              name="opening"
              defaultValue={localDate(m.opensAt)}
              readOnly={!setup}
              required
            />
          </Field>
          {(["S-Tier", "A-Tier", "B-Tier"] as const).map((tier, i) => (
            <Field key={tier} label={`${tier} first tally`}>
              <input
                className={FIELD}
                type="datetime-local"
                name={`tally${i}`}
                defaultValue={localDate(m.schedule.firstTallyAt[i])}
                readOnly={v.now >= m.schedule.firstTallyAt[i]}
                required
              />
            </Field>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Initial window in seconds">
              <input
                className={FIELD}
                name="initialWindow"
                inputMode="numeric"
                defaultValue={m.schedule.initialWindow}
                readOnly={!setup}
                required
              />
            </Field>
            <Field label="Maximum windows">
              <input
                className={FIELD}
                name="maxWindows"
                inputMode="numeric"
                defaultValue={m.schedule.maxWindows}
                readOnly={!setup}
                required
              />
            </Field>
          </div>
          {reviewButton(v.final)}
        </form>
      </Section>
      <Section title="Currencies">
        <p className="text-[12px] text-muted">
          Pricing and allowed currencies freeze at opening. Disabling a currency stops both its
          donations and pledges from counting.
        </p>
        {(m.currencies?.length ?? 0) > 1 && (
          <>
            <Field label="Registered currency">
              <select
                className={FIELD}
                value={currency}
                onChange={(e) => setCurrency(Number(e.target.value))}
              >
                {m.currencies!.slice(1).map((c, i) => (
                  <option key={i + 1} value={i + 1}>
                    {c.symbol}
                    {c.disabled ? " · disabled" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <form
              key={currency}
              className="space-y-3"
              onSubmit={submit(
                "currency",
                (f) => ({ id: String(currency), disabled: f.get("disabled") === "on" }),
              )}
            >
              <p className="break-all text-[12px] text-muted">
                Token: {m.currencies![currency].asset}
              </p>
              <Field label="USD price feed">
                <input
                  className={FIELD}
                  name="usdFeed"
                  defaultValue={m.currencies![currency].usdFeed}
                  required
                />
              </Field>
              <label className="flex gap-2 text-[13px]">
                <input
                  name="disabled"
                  type="checkbox"
                  defaultChecked={m.currencies![currency].disabled}
                />Disable this currency
              </label>
              {reviewButton(!setup)}
            </form>
          </>
        )}
        <form className="space-y-3 border-t border-edge pt-3" onSubmit={submit("registerCurrency")}>
          <Field label="New token address">
            <input className={FIELD} name="asset" placeholder="0x…" required />
          </Field>
          <Field label="New token USD feed">
            <input className={FIELD} name="usdFeed" defaultValue={ZERO} required />
          </Field>
          <p className="text-[12px] text-muted">
            A zero feed uses $1 per whole token. Native currency always needs a feed.
          </p>
          {reviewButton(!setup)}
        </form>
      </Section>
      <Section title="Names and metadata">
        {m.groups.length > 0 && (
          <form className="space-y-3" onSubmit={submit("group")}>
            <Field label="Affiliation to rename">
              <select className={FIELD} name="id">
                {m.groups.map((g, i) => <option key={i} value={i}>{g}</option>)}
              </select>
            </Field>
            <Field label="New affiliation name">
              <input className={FIELD} name="name" required />
            </Field>
            {reviewButton()}
          </form>
        )}
        <form className="space-y-3 border-t border-edge pt-3" onSubmit={submit("metadata")}>
          <Field label="NFT metadata base URL">
            <input className={FIELD} name="uri" placeholder="ipfs://…/" />
          </Field>
          {reviewButton()}
        </form>
      </Section>
      {error && <Status kind="err">{error}</Status>}
      {review && (
        <div
          className="mt-3 rounded-xl border border-dao-green/40 bg-dao-green/5 p-4"
          role="status"
        >
          <p className="mb-3 break-words text-[13px]">{review.summary}</p>
          <Button sm onClick={save}>Download reviewed Safe batch</Button>
          <p className="mt-2 text-[12px] text-muted">
            Import this file in the admin Safe's Transaction Builder. It will refuse to execute if
            the reviewed configuration has changed.
          </p>
        </div>
      )}
    </div>
  );
}

function InitiativeFields({ view: v, id, disabled, submit, button }: {
  view: CorrectionView;
  id: number;
  disabled: boolean;
  submit: (
    action: string,
    extra: (f: FormData) => Record<string, unknown>,
  ) => (e: FormEvent<HTMLFormElement>) => void;
  button: (disabled?: boolean) => ReactNode;
}) {
  const m = v.manifest;
  const p = m.projects[id];
  const [rfp, setRfp] = useState(p.rfp);
  return (
    <form
      className="space-y-3"
      onSubmit={submit("initiative", (f) => ({
        id: String(id),
        rfp,
        groups: rfp ? [] : f.getAll("group").map(Number),
      }))}
    >
      <p className="text-[12px] text-muted">
        Safe (counts donations, never changed here):{" "}
        <span className="font-mono text-white">{m.accounts?.[id]}</span>
      </p>
      <Field label="Dollar goal">
        <input
          className={FIELD}
          name="goalUsd"
          inputMode="decimal"
          defaultValue={usd(p.goalUsd)}
          required
        />
      </Field>
      <label className="flex gap-2 text-[13px]">
        <input type="checkbox" checked={rfp} onChange={(e) => setRfp(e.target.checked)} />RFP
      </label>
      <fieldset disabled={rfp} className="flex flex-wrap gap-3 disabled:opacity-50">
        <legend className="mb-1 text-[12px] text-muted">Affiliations</legend>
        {m.groups.map((g, i) => (
          <label key={i} className="flex gap-1.5 text-[12px]">
            <input type="checkbox" name="group" value={i} defaultChecked={p.groups.includes(i)} />
            {g}
          </label>
        ))}
      </fieldset>
      {button(disabled)}
    </form>
  );
}
