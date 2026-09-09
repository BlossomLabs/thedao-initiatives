import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { sendTransaction } from "wagmi/actions";
import { useAccount, useConfig } from "wagmi";
import { ExternalLink, MessageSquare, RefreshCw, Trash2, Upload } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { Field, Input, Select, Textarea } from "~/components/ui/Field";
import Skeleton from "~/components/ui/Skeleton";
import Status, { type StatusKind } from "~/components/ui/Status";
import FundingHead from "~/components/initiative/FundingHead";
import Identity from "~/components/wallet/Identity";
import { api, errorMessage } from "~/lib/api";
import type {
  AdminInitiative,
  AdminInitiativePage,
  SafeConfirmResult,
  SafeDeployParams,
  SafeSyncState,
} from "~/lib/api-types";
import { walletErrorMessage } from "~/lib/donate";
import { dt, shortAddr, usd } from "~/lib/format";

type Msg = { kind: StatusKind; text: string } | null;
type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

const STATUS_HELP: Record<string, string> = {
  pending: "Submitted and waiting for review. It is not on the board yet.",
  approved: "Live on the board. Donations count once its Safe is deployed.",
  rejected: "Hidden from the board. Approve it to publish it after all.",
  archived: "Hidden from the board; its public page stays reachable.",
};

/** Admin editor for one initiative: same two-column layout as the public page. */
export default function AdminInitiativeEditor() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const key = ["admin", "initiative", id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api<AdminInitiativePage>(`/api/admin/initiatives/${id}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const [msg, setMsg] = useState<Msg>(null);
  const run: Run = async (fn, ok) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ kind: "ok", text: ok });
      refresh();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    }
  };

  if (isLoading) {
    return (
      <PageMain detail>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-10 w-2/3" />
        <Skeleton className="mt-8 h-32" />
      </PageMain>
    );
  }
  if (error || !data) {
    return (
      <PageMain detail>
        <p className="m-0 mb-2.5">
          <Link to="/admin/dashboard">← Dashboard</Link>
        </p>
        <p className="alert">{error instanceof Error ? error.message : "Not found."}</p>
      </PageMain>
    );
  }
  const r = data.initiative;
  const base = `/api/admin/initiatives/${r.id}`;
  const pct = r.goalUsd > 0 ? (data.summary.total / r.goalUsd) * 100 : 0;

  return (
    <PageMain detail>
      <p className="m-0 mb-2.5">
        <Link to="/admin/dashboard">← Dashboard</Link>
      </p>
      <h1 className="m-0 mb-3 mt-1.5 font-inter-tight text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] tracking-[-.02em]">
        {r.title}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-3">
        <TypeBadge type={r.type} inline />
        <StatusChip status={r.status} />
        <span className="small dim">
          created {dt(r.createdAt)} · <span className="mono">{r.slug}</span>
        </span>
      </p>
      {msg && <Status kind={msg.kind} className="mt-4">{msg.text}</Status>}

      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <FundingHead
            summary={data.summary}
            goal={r.goalUsd}
            pct={pct}
            funded={r.goalUsd > 0 && data.summary.total >= r.goalUsd}
          />

          <SectionHeading>Edit initiative</SectionHeading>
          <EditForm
            r={r}
            onSave={(patch) => run(() => api(base, { method: "PATCH", json: patch }), "Saved.")}
          />

          <SectionHeading count={data.pledges.length}>Backer pledges</SectionHeading>
          <Pledges page={data} base={base} run={run} />

          <SectionHeading count={data.donations.length}>Donations</SectionHeading>
          <Donations page={data} base={base} run={run} />
        </div>

        <aside className="sticky top-[86px] flex flex-col gap-3.5 max-[960px]:static">
          <div className="panel">
            <span className="k">Status</span>
            <p className="m-0 flex items-center gap-2.5">
              <StatusChip status={r.status} />
              <span className="small dim">{STATUS_HELP[r.status]}</span>
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {r.status !== "approved" && r.status !== "archived" && (
                <Button
                  variant="primary"
                  sm
                  onClick={() =>
                    run(() => api(`${base}/status`, { json: { action: "approve" } }), "Approved.")}
                >
                  Approve
                </Button>
              )}
              {r.status === "pending" && (
                <Button
                  variant="danger"
                  sm
                  onClick={() =>
                    run(() => api(`${base}/status`, { json: { action: "reject" } }), "Rejected.")}
                >
                  Reject
                </Button>
              )}
              {r.status === "approved" && (
                <Button
                  variant="ghost"
                  sm
                  onClick={() =>
                    run(() => api(`${base}/status`, { json: { action: "archive" } }), "Archived.")}
                >
                  Archive
                </Button>
              )}
              {r.status === "archived" && (
                <Button
                  sm
                  onClick={() =>
                    run(
                      () => api(`${base}/status`, { json: { action: "unarchive" } }),
                      "Re-approved.",
                    )}
                >
                  Re-approve
                </Button>
              )}
            </div>
          </div>

          <SafeCard page={data} onChange={refresh} />

          <div className="panel">
            <span className="k">Links</span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 small">
              <li>
                <Link to={`/initiative/${r.slug}`}>
                  Public page{r.status !== "approved" && " (unlisted)"}
                </Link>
              </li>
              {r.discourseUrl && (
                <li>
                  <a href={r.discourseUrl} target="_blank" rel="noopener">
                    <MessageSquare className="mr-1.5 inline size-3.5 align-[-2px]" />
                    Forum thread
                  </a>
                </li>
              )}
              {r.safeAddress && (
                <li>
                  <a
                    href={`https://etherscan.io/address/${r.safeAddress}`}
                    target="_blank"
                    rel="noopener"
                  >
                    <ExternalLink className="mr-1.5 inline size-3.5 align-[-2px]" />
                    Safe on Etherscan
                  </a>
                </li>
              )}
              {r.proposer && (
                <li className="dim flex items-center gap-1.5">
                  Proposed by{" "}
                  <Identity address={r.proposer} size={16} nameClassName="text-[13px]" />
                </li>
              )}
              {r.contact && (
                <li className="dim">
                  Contact: <span className="text-soft">{r.contact}</span>
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </PageMain>
  );
}

function SafeCard({ page, onChange }: { page: AdminInitiativePage; onChange: () => void }) {
  const r = page.initiative;
  const config = useConfig();
  const { isConnected } = useAccount();
  const [status, setStatus] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncState, setSyncState] = useState<SafeSyncState | null>(page.safeSync);
  useEffect(() => setSyncState(page.safeSync), [page.safeSync]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const [existing, setExisting] = useState("");
  /** Bind a Safe that already exists: verified on-chain like a fresh deploy. */
  const attach = async () => {
    const address = existing.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setStatus({ kind: "err", text: "That is not an Ethereum address (0x + 40 hex characters)." });
      return;
    }
    setStatus({ kind: "wait", text: "Verifying the Safe's owners and threshold on-chain…" });
    setBusy(true);
    const res = await api<SafeConfirmResult>(`/api/admin/initiatives/${r.id}/safe-confirm`, {
      json: { address },
    }).catch((e) => ({ status: "error", detail: errorMessage(e) } as SafeConfirmResult));
    setBusy(false);
    if (res.status === "ok") {
      setStatus({ kind: "ok", text: `Safe ${res.address} verified: ${res.detail}` });
      setExisting("");
      onChange();
    } else setStatus({ kind: "err", text: res.detail });
  };
  const attachForm = (
    <form
      className="mt-4 border-t border-edge pt-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void attach();
      }}
    >
      <label className="small dim block" htmlFor="safe-existing">
        Or use a Safe that is already deployed
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="safe-existing"
          className="mono min-w-0 flex-1 py-2 text-[12px]"
          placeholder="0x…"
          spellCheck={false}
          value={existing}
          onChange={(e) => setExisting(e.target.value)}
        />
        <Button type="submit" sm variant="ghost" className="m-0 flex-none" loading={busy}>
          Use this Safe
        </Button>
      </div>
      <p className="m-0 mt-1.5 small dim">
        Must be a {page.signers.threshold}-of-{page.signers.list.length}{" "}
        canonical Safe owned by the operational signers; anything else is rejected.
      </p>
    </form>
  );

  const confirmDeploy = async (txHash: string) => {
    const res = await api<SafeConfirmResult>(`/api/admin/initiatives/${r.id}/safe-confirm`, {
      json: { txHash },
    }).catch((e) => ({ status: "error", detail: errorMessage(e) } as SafeConfirmResult));
    if (res.status === "pending") {
      setStatus({ kind: "wait", text: "Waiting for the deploy transaction to be mined…" });
      timer.current = globalThis.setTimeout(() => void confirmDeploy(txHash), 6000);
      return;
    }
    setBusy(false);
    if (res.status === "ok") {
      setStatus({ kind: "ok", text: `Safe ${res.address} verified: ${res.detail}` });
      onChange();
    } else setStatus({ kind: "err", text: res.detail });
  };

  const deploy = async () => {
    setStatus(null);
    setBusy(true);
    try {
      const p = await api<SafeDeployParams>(`/api/admin/initiatives/${r.id}/safe-deploy-params`);
      if (!p.enabled) throw new Error(p.reason);
      setStatus({
        kind: "wait",
        text:
          `Confirm the deploy transaction in your wallet (${p.threshold}-of-${p.signers.length} Safe via the canonical factory).`,
      });
      const txHash = await sendTransaction(config, {
        to: p.factory as `0x${string}`,
        data: p.calldata as `0x${string}`,
        chainId: 1,
      });
      setStatus({ kind: "wait", text: `Sent ${shortAddr(txHash)}. Waiting for confirmation…` });
      await confirmDeploy(txHash.toLowerCase());
    } catch (e) {
      setBusy(false);
      setStatus({ kind: "err", text: walletErrorMessage(e) });
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const res = await api<{ safeSync: SafeSyncState }>(
        `/api/admin/initiatives/${r.id}/sync-donations`,
        { method: "POST" },
      );
      setSyncState(res.safeSync);
      setStatus(
        res.safeSync.ok
          ? { kind: "ok", text: "Synced with the Safe Transaction Service." }
          : { kind: "err", text: res.safeSync.error },
      );
      onChange();
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (r.safeAddress) {
    body = (
      <>
        <p className="m-0 flex flex-wrap items-center gap-2">
          <span className="chip st-approved">
            {page.signers.threshold}-of-{page.signers.list.length}
          </span>
          <span className="small text-dao-green">deployed and verified</span>
        </p>
        <a
          className="mono mt-2.5 block rounded-[10px] border border-edge bg-black/15 px-3 py-2 text-[11.5px] [overflow-wrap:anywhere]"
          href={`https://etherscan.io/address/${r.safeAddress}`}
          target="_blank"
          rel="noopener"
        >
          {r.safeAddress}
        </a>
        <p className="m-0 mt-2.5 small dim">
          Indexer sync: {syncState
            ? (syncState.ok
              ? `${syncState.backfilled ? "up to date" : "backfilling"}, last run ${
                dt(syncState.at)
              }`
              : `error: ${syncState.error}`)
            : "never run"}
        </p>
        <Button sm variant="ghost" className="mt-3 w-full" loading={busy} onClick={sync}>
          <RefreshCw className="size-3.5" />Sync donations now
        </Button>
      </>
    );
  } else if (!page.signers.ok) {
    body = (
      <p className="m-0 small">
        Safe deployment is disabled: <b>{page.signers.detail}</b>.
      </p>
    );
  } else if (r.status !== "approved") {
    body = (
      <>
        <p className="m-0 small dim">
          Approve this initiative first, then deploy its donation Safe.
        </p>
        {attachForm}
      </>
    );
  } else {
    body = (
      <>
        <p className="m-0 small dim">
          Deploys a {page.signers.threshold}-of-{page.signers.list.length}{" "}
          Gnosis Safe owned by the operational signers. One transaction from your wallet; the app
          verifies owners and threshold on-chain before showing the address to donors.
        </p>
        <Button
          variant="primary"
          sm
          className="mt-3 w-full"
          loading={busy}
          disabled={!isConnected}
          onClick={deploy}
        >
          {isConnected ? "Deploy Safe" : "Connect a wallet to deploy"}
        </Button>
        {attachForm}
      </>
    );
  }
  return (
    <div className="panel">
      <span className="k">Donation Safe</span>
      {body}
      {status && <Status kind={status.kind} className="mt-3">{status.text}</Status>}
    </div>
  );
}

function EditForm(
  { r, onSave }: { r: AdminInitiative; onSave: (patch: Record<string, unknown>) => Promise<void> },
) {
  const fromInitiative = () => ({
    title: r.title,
    type: r.type,
    summary: r.summary,
    details: r.details,
    discourseUrl: r.discourseUrl,
    goal: String(r.goalUsd),
    sortRank: r.sortRank ? String(r.sortRank) : "",
    contact: r.contact,
    funders: r.funders,
  });
  const [f, setF] = useState(fromInitiative);
  useEffect(() => setF(fromInitiative()), [r]);
  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="panel flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        onSave(f).finally(() => setBusy(false));
      }}
    >
      <Field label="Title" htmlFor="e-title">
        <Input id="e-title" maxLength={140} value={f.title} onChange={set("title")} />
      </Field>
      <div className="grid grid-cols-2 gap-x-4 max-[640px]:grid-cols-1 [&>*:first-child]:mt-[18px]">
        <Field label="Type" htmlFor="e-type">
          <Select id="e-type" value={f.type} onChange={set("type")}>
            <option value="rfp">RFP (open competitive bid)</option>
            <option value="grant">Grant (proposing team does the work)</option>
          </Select>
        </Field>
        <Field label="Funding goal (USD)" htmlFor="e-goal">
          <Input id="e-goal" inputMode="decimal" value={f.goal} onChange={set("goal")} />
        </Field>
      </div>
      <Field label="Summary" htmlFor="e-summary" hint="Shown on the board card.">
        <Textarea
          id="e-summary"
          rows={4}
          maxLength={4000}
          value={f.summary}
          onChange={set("summary")}
        />
      </Field>
      <Field
        label="Full initiative details"
        htmlFor="e-details"
        hint="Markdown: headings, **bold**, lists, tables, - [ ] checklists."
      >
        <Textarea
          id="e-details"
          rows={12}
          maxLength={20000}
          className="mono text-[13px] leading-[1.55]"
          value={f.details}
          onChange={set("details")}
        />
      </Field>
      <div className="grid grid-cols-2 gap-x-4 max-[640px]:grid-cols-1 [&>*:first-child]:mt-[18px]">
        <Field label="Forum link" htmlFor="e-forum">
          <Input id="e-forum" type="url" value={f.discourseUrl} onChange={set("discourseUrl")} />
        </Field>
        <Field
          label="Pin to board position"
          htmlFor="e-pin"
          hint="1 = top; blank = sort by money raised."
        >
          <Input id="e-pin" inputMode="numeric" value={f.sortRank} onChange={set("sortRank")} />
        </Field>
      </div>
      <Field label="Contact" htmlFor="e-contact" privateField>
        <Input id="e-contact" maxLength={200} value={f.contact} onChange={set("contact")} />
      </Field>
      <Field label="Who is likely to fund this?" htmlFor="e-funders" privateField>
        <Textarea
          id="e-funders"
          rows={4}
          maxLength={4000}
          value={f.funders}
          onChange={set("funders")}
        />
      </Field>
      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" variant="primary" sm loading={busy}>Save changes</Button>
        <span className="small dim">Edits go live immediately.</span>
      </div>
    </form>
  );
}

function Pledges({ page, base, run }: { page: AdminInitiativePage; base: string; run: Run }) {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [logoName, setLogoName] = useState("");
  return (
    <>
      {page.pledges.length > 0 && (
        <div className="tblbox mb-3.5">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th className="amt">Amount</th>
                <th>Status</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {page.pledges.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.logoUrl && (
                      <img
                        src={p.logoUrl}
                        alt=""
                        className="mr-2 inline h-6 rounded bg-white p-0.5 align-middle"
                      />
                    )}
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noopener">{p.company}</a>
                      : p.company}
                  </td>
                  <td className="amt">{usd(p.amountUsd)}</td>
                  <td>
                    <Select
                      className="w-auto rounded-[10px] px-2.5 py-1.5 text-[12px]"
                      value={p.status}
                      onChange={(e) =>
                        run(() =>
                          api(`${base}/pledges/${p.id}`, {
                            method: "PATCH",
                            json: { status: e.target.value },
                          })
                        )}
                    >
                      {["pledged", "received", "withdrawn"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="small dim">{p.note}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="cursor-pointer rounded-[9px] border border-transparent bg-transparent p-1.5 text-[#ffb3b1] hover:border-[rgba(255,59,56,.6)]"
                      title="Delete pledge"
                      onClick={() =>
                        confirm(`Delete the pledge from ${p.company}?`) &&
                        run(
                          () => api(`${base}/pledges/${p.id}`, { method: "DELETE" }),
                          "Pledge deleted.",
                        )}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        ref={ref}
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          run(() => api(`${base}/pledges`, { form }), "Pledge added.")
            .then(() => {
              ref.current?.reset();
              setLogoName("");
            })
            .finally(() => setBusy(false));
        }}
      >
        <span className="k">Add a pledge</span>
        <div className="grid grid-cols-[1fr_140px_130px] gap-2.5 max-[640px]:grid-cols-1">
          <Input name="company" placeholder="Company *" maxLength={120} required />
          <Input name="amount" placeholder="Amount USD *" inputMode="decimal" required />
          <Select name="status">
            <option value="pledged">pledged</option>
            <option value="received">received</option>
          </Select>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 max-[640px]:grid-cols-1">
          <Input name="url" placeholder="Link (optional)" maxLength={300} />
          <Input name="note" placeholder="Note (optional)" maxLength={300} />
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <Button type="submit" sm loading={busy}>Add pledge</Button>
          <label className="btn btn-ghost btn-sm cursor-pointer">
            <Upload className="size-3.5" />
            {logoName || "Logo (optional)"}
            <input
              type="file"
              name="logo"
              accept=".png,.jpg,.jpeg,.webp"
              className="sr-only"
              onChange={(e) => setLogoName(e.target.files?.[0]?.name ?? "")}
            />
          </label>
          <span className="small dim">PNG, JPG or WEBP; shown on the public page.</span>
        </div>
      </form>
    </>
  );
}

function Donations({ page, base, run }: { page: AdminInitiativePage; base: string; run: Run }) {
  const [tx, setTx] = useState("");
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx.trim());
  return (
    <>
      {page.donations.length > 0
        ? (
          <div className="tblbox mb-3.5">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th className="amt">USD</th>
                  <th>Token</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {page.donations.map((d) => (
                  <tr key={d.txHash}>
                    <td className="whitespace-nowrap">{dt(d.confirmedAt ?? d.createdAt)}</td>
                    <td>
                      {d.donor
                        ? (
                          <Identity
                            address={d.donor}
                            size={18}
                            nameClassName="text-[12.5px] font-normal text-white"
                          />
                        )
                        : <span className="mono">—</span>}
                    </td>
                    <td className="amt">{usd(d.amountUsd)}</td>
                    <td>
                      {d.tokenSymbol}
                      {d.source === "safe-api" && <span className="dim">(indexer)</span>}
                    </td>
                    <td>
                      <span
                        className={`chip st-${
                          d.status === "confirmed"
                            ? "approved"
                            : d.status === "failed"
                            ? "rejected"
                            : "pending"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="small dim">{d.detail}</td>
                    <td className="mono">
                      <a
                        href={`https://etherscan.io/tx/${d.txHash}`}
                        target="_blank"
                        rel="noopener"
                      >
                        {shortAddr(d.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        : (
          <p className="m-0 mb-3.5 small dim">
            No donations recorded yet. Transfers to the Safe are picked up by the indexer sync;
            paste a transaction hash below to check one right away.
          </p>
        )}
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          void run(
            () => api(`${base}/donations/recheck`, { json: { txHash: tx.trim().toLowerCase() } }),
            "Rechecked.",
          );
        }}
      >
        <span className="k">Check a transaction</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            className="mono min-w-[280px] flex-1"
            placeholder="0x… transaction hash"
            value={tx}
            onChange={(e) => setTx(e.target.value)}
          />
          <Button type="submit" variant="ghost" disabled={!valid}>Recheck</Button>
        </div>
      </form>
    </>
  );
}
