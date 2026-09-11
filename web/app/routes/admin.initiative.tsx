import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { sendTransaction } from "wagmi/actions";
import { useAccount, useConfig } from "wagmi";
import { ExternalLink, MessageSquare, RefreshCw, Trash2, Upload } from "lucide-react";
import { RevisionAuthor } from "~/components/initiative/RevisionBar";
import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import SectionHeading from "~/components/layout/SectionHeading";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { Field, Input, Select } from "~/components/ui/Field";
import Skeleton from "~/components/ui/Skeleton";
import Status, { type StatusKind } from "~/components/ui/Status";
import FundingHead from "~/components/initiative/FundingHead";
import InitiativeForm from "~/components/initiative-form/InitiativeForm";
import type { SubmitPayload } from "~/components/initiative-form/types";
import { fromInitiative } from "~/components/initiative-form/useDraft";
import Identity from "~/components/wallet/Identity";
import { api, errorMessage } from "~/lib/api";
import type {
  AdminInitiative,
  AdminInitiativePage,
  Findings,
  SafeConfirmResult,
  SafeDeployParams,
  SafeSyncState,
} from "~/lib/api-types";
import { LEGACY_NOTE } from "~/lib/edit-initiative";
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
        <Crumbs
          items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]}
        />
        <p className="alert">{error instanceof Error ? error.message : "Not found."}</p>
      </PageMain>
    );
  }
  const r = data.initiative;
  const base = `/api/admin/initiatives/${r.id}`;
  const pct = r.goalUsd > 0 ? (data.summary.total / r.goalUsd) * 100 : 0;

  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]} />
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
            key={r.id}
            r={r}
            onSaved={(text) => {
              setMsg({ kind: "ok", text });
              refresh();
            }}
          />

          <SectionHeading count={data.revisions.length}>Revisions</SectionHeading>
          <Revisions page={data} base={base} run={run} />

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

/**
 * The same form as the submit page, in admin mode: nothing blocks the
 * button, the server's editorial findings come back as open points. The
 * admin-only knobs (board pin, owner) ride the same PATCH.
 */
function EditForm({ r, onSaved }: { r: AdminInitiative; onSaved: (text: string) => void }) {
  const extrasOf = () => ({
    sortRank: r.sortRank ? String(r.sortRank) : "",
    proposer: r.proposer,
  });
  const [extras, setExtras] = useState(extrasOf);
  useEffect(() => setExtras(extrasOf()), [r.sortRank, r.proposer]);
  const [open, setOpen] = useState<Findings | null>(null);
  const [initial] = useState(() => fromInitiative(r));

  async function onSubmit(payload: SubmitPayload) {
    const { website: _hp, backers: _bk, ...fields } = payload;
    const body = { ...fields, sortRank: extras.sortRank, proposer: extras.proposer };
    const res = await api<{ initiative: AdminInitiative; findings: Findings }>(
      `/api/admin/initiatives/${r.id}`,
      { method: "PATCH", json: body },
    );
    const points = res.findings.errors.length || res.findings.warnings.length ? res.findings : null;
    setOpen(points);
    onSaved("Saved.");
    return points;
  }

  return (
    <div className="panel">
      <InitiativeForm
        mode="admin"
        initial={initial}
        locked={false}
        enforce={false}
        layout="inline"
        onSubmit={onSubmit}
        submitLabel="Save changes"
        showBackers={false}
        showPrivate
        showTypePicker
        showRules={false}
        autosaveKey={null}
        pasteText={r.structured ? undefined : r.details}
        pasteNote={r.structured ? undefined : LEGACY_NOTE}
        before={
          <>
            <div className="grid grid-cols-2 gap-x-4 max-[640px]:grid-cols-1 [&>*:first-child]:mt-[18px]">
              <Field label="Pin to board position" htmlFor="e-pin">
                <Input
                  id="e-pin"
                  inputMode="numeric"
                  placeholder="1 = top; blank = sort by money raised."
                  value={extras.sortRank}
                  onChange={(e) => setExtras((s) => ({ ...s, sortRank: e.target.value }))}
                />
              </Field>
              <Field
                label="Owner"
                htmlFor="e-owner"
                hint="Wallet address or ENS name. Shown publicly as “Proposed by”; blank to hide."
              >
                <Input
                  id="e-owner"
                  maxLength={100}
                  placeholder="0x… or name.eth"
                  className="mono"
                  value={extras.proposer}
                  onChange={(e) => setExtras((s) => ({ ...s, proposer: e.target.value }))}
                />
              </Field>
            </div>
          </>
        }
        footer={
          <>
            <p className="m-0 mt-3 text-center small dim">
              Goes live immediately; a changed title, summary, section, milestone or link is saved
              as a new public revision.
            </p>
            {open && (
              <div
                className="mt-4 rounded-2xl border border-[rgba(240,180,41,.5)] bg-[rgba(240,180,41,.06)] px-5 py-4"
                role="status"
              >
                <p className="m-0 small text-[#ffe9b8]">
                  The page is saved; the reviewer sees these open points:
                </p>
                <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 small">
                  {[...open.errors, ...open.warnings].map((f, i) => (
                    <li key={i} className={f.kind ? "text-[#ffd7d6]" : "text-[#ffe9b8]"}>
                      {f.msg}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}

/** The public history: every version of the text, with archive as the only edit. */
function Revisions({ page, base, run }: { page: AdminInitiativePage; base: string; run: Run }) {
  const r = page.initiative;
  if (!page.revisions.length) {
    return (
      <p className="m-0 mb-3.5 small dim">
        No history yet: this initiative predates revisions. Its first edit will keep the text shown
        today as revision 1.
      </p>
    );
  }
  return (
    <div className="tblbox mb-3.5">
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Author</th>
            <th>Date</th>
            <th>Visibility</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...page.revisions].reverse().map((v) => {
            const isCurrent = v.n === r.revision;
            return (
              <tr key={v.n} className={v.archived ? "[&>td]:opacity-60" : undefined}>
                <td className="mono">{v.n}</td>
                <td className="small">
                  <RevisionAuthor rev={v} />
                </td>
                <td className="whitespace-nowrap">{dt(v.createdAt)}</td>
                <td>
                  {isCurrent
                    ? <span className="chip st-approved">current</span>
                    : v.archived
                    ? <span className="chip st-archived">archived</span>
                    : <span className="chip">public</span>}
                </td>
                <td className="whitespace-nowrap text-right">
                  <Link
                    className="btn btn-ghost btn-sm mr-1.5"
                    to={`/initiative/${r.slug}${isCurrent ? "" : `?rev=${v.n}`}`}
                  >
                    View
                  </Link>
                  <Button
                    sm
                    variant="ghost"
                    disabled={isCurrent}
                    title={isCurrent
                      ? "The current revision cannot be archived; save a new one to replace it."
                      : v.archived
                      ? "Show it in the public history again"
                      : "Hide it from the public history (admins still see it)"}
                    onClick={() =>
                      run(
                        () =>
                          api(`${base}/revisions/${v.n}`, {
                            json: { action: v.archived ? "unarchive" : "archive" },
                          }),
                        v.archived ? "Revision restored." : "Revision archived.",
                      )}
                  >
                    {v.archived ? "Unarchive" : "Archive"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
