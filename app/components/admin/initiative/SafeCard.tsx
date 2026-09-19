import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { useAccount, useConfig } from "wagmi";
import { RefreshCw } from "lucide-react";
import GovernedBy from "~/components/terms/GovernedBy";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { sessionKey, useSession } from "~/context/session";
import { useAdminApi } from "~/hooks/use-admin-api";
import { api, errorMessage } from "~/lib/api";
import type {
  AdminInitiativePage,
  SafeConfirmResult,
  SafeDeployParams,
  SafeSyncState,
} from "~/lib/api-types";
import { walletErrorMessage } from "~/lib/donate";
import { dt, shortAddr } from "~/lib/format";
import type { Msg } from "./run";

/** The deploy flow shared by the Approve button and the Safe card. */
export function useSafeDeploy(id: string, onChange: () => void) {
  const adminApi = useAdminApi();
  const config = useConfig();
  const [status, setStatus] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/initiatives/${id}`;

  /**
   * Make sure the initiative's Safe exists and is bound, deploying it from the
   * admin's wallet if not. The server binds on code at the predicted CREATE2
   * address (a Safe wallet or a sped-up tx mines under another hash), so the
   * browser watches its own receipt for a revert and then asks the server
   * until the Safe is there. Resolves to the address; throws on failure.
   */
  const ensureDeployed = async (): Promise<string> => {
    setStatus(null);
    setBusy(true);
    try {
      const p = await api<SafeDeployParams>(`${base}/safe-deploy-params`);
      if (!p.enabled) throw new Error(p.reason);
      if (!p.deployed) {
        setStatus({
          kind: "wait",
          text:
            `Confirm the Safe deploy in your wallet (${p.threshold}-of-${p.signers.length} via the canonical factory, to ${p.address}).`,
        });
        const hash = await sendTransaction(config, {
          to: p.factory as `0x${string}`,
          data: p.calldata as `0x${string}`,
          chainId: 1,
        });
        setStatus({ kind: "wait", text: `Sent ${shortAddr(hash)}. Waiting for it to be mined…` });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: 1 });
        if (receipt.status !== "success") {
          throw new Error("The deploy transaction reverted; nothing was deployed.");
        }
      }
      for (let attempt = 0;; attempt++) {
        const res = await adminApi<SafeConfirmResult>(`${base}/safe-confirm`, { json: {} })
          .catch((e) => ({ status: "error", detail: errorMessage(e) } as SafeConfirmResult));
        if (res.status === "ok") {
          setStatus({ kind: "ok", text: `Safe ${res.address} verified: ${res.detail}` });
          onChange();
          return res.address!;
        }
        if (res.status !== "pending" || attempt >= 20) throw new Error(res.detail);
        setStatus({ kind: "wait", text: "Waiting for the Safe to show up on-chain…" });
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (e) {
      setStatus({ kind: "err", text: "Safe not deployed: " + walletErrorMessage(e) });
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return { ensureDeployed, status, busy };
}

export default function SafeCard(
  { page, safe, onChange }: {
    page: AdminInitiativePage;
    safe: ReturnType<typeof useSafeDeploy>;
    onChange: () => void;
  },
) {
  const adminApi = useAdminApi();
  const { session } = useSession();
  const r = page.initiative;
  const { isConnected } = useAccount();
  const [status, setStatus] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<SafeSyncState | null>(page.safeSync);
  useEffect(() => setSyncState(page.safeSync), [page.safeSync]);
  // Unbound: is the Safe already at its CREATE2 address (a deploy the browser
  // lost track of, or one made from another environment)? Then it is linked,
  // not deployed again: the factory would only revert at an occupied address.
  const params = useQuery({
    queryKey: ["admin", "safe-deploy-params", r.id, sessionKey(session)],
    queryFn: ({ signal }) =>
      api<SafeDeployParams>(`/api/admin/initiatives/${r.id}/safe-deploy-params`, { signal }),
    enabled: !r.safeAddress && page.signers.ok,
  });
  const existing = !r.safeAddress && params.data?.enabled && params.data.deployed
    ? params.data.address
    : null;

  const link = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await adminApi<SafeConfirmResult>(`/api/admin/initiatives/${r.id}/safe-confirm`, {
        json: {},
      }).catch((e) => ({ status: "error", detail: errorMessage(e) } as SafeConfirmResult));
      if (res.status !== "ok") throw new Error(res.detail);
      setStatus({ kind: "ok", text: `Safe ${res.address} linked: ${res.detail}` });
      onChange();
    } catch (e) {
      setStatus({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
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
          href={`https://eth.blockscout.com/address/${r.safeAddress}`}
          target="_blank"
          rel="noopener"
        >
          {r.safeAddress}
        </a>
        <GovernedBy className="mt-1.5" />
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
  } else if (existing) {
    body = (
      <>
        <p className="m-0 small dim">
          A Safe already exists at this initiative's address but is not linked yet. Linking checks
          on-chain that it is a {page.signers.threshold}-of-{page.signers.list.length}{" "}
          Safe owned by the operational signers on the canonical singleton before binding it.
        </p>
        <span className="mono mt-2.5 block rounded-[10px] border border-edge bg-black/15 px-3 py-2 text-[11.5px] [overflow-wrap:anywhere]">
          {existing}
        </span>
        <Button variant="ghost" sm className="mt-3 w-full" loading={busy} onClick={link}>
          Link the Safe
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="m-0 small dim">
          Approving deploys a {page.signers.threshold}-of-{page.signers.list.length}{" "}
          Safe owned by the operational signers: one transaction from your wallet via the canonical
          factory, verified on-chain before the initiative goes live. Or deploy it ahead of time:
        </p>
        <Button
          variant="ghost"
          sm
          className="mt-3 w-full"
          loading={safe.busy}
          disabled={!isConnected}
          onClick={() => void safe.ensureDeployed().catch(() => {})}
        >
          {isConnected ? "Deploy Safe now" : "Connect a wallet to deploy"}
        </Button>
      </>
    );
  }
  const shown = safe.status ?? status;
  return (
    <div className="panel">
      <span className="k">Donation Safe</span>
      {body}
      {shown && <Status kind={shown.kind} className="mt-3">{shown.text}</Status>}
    </div>
  );
}
