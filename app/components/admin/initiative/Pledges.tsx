import { useRound } from "~/lib/vote-round";
import { useCallback, useEffect, useRef, useState } from "react";
import { PencilLine, Trash2, Upload } from "lucide-react";
import type { Hex } from "viem";
import { signTypedData } from "wagmi/actions";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ApiOptions } from "~/lib/api";
import { apiCode } from "~/hooks/use-vote";
import { voteClient } from "~/hooks/use-vote-send";
import { explorerTx, type VoteChain } from "~/components/vote/BallotStatus";
import {
  type Busy,
  type PledgeFlowDeps,
  type PledgePhase,
  sendPledge,
  type SettleState,
  TOO_LONG,
} from "~/lib/pledge-flow";
import {
  MAINNET_CHAIN_ID,
  onBallotSlugs,
  type VoteManifest,
} from "../../../../shared/vote/manifest";
import type { AdminInitiativePage, AwaitingPledgeJson, Pledge } from "~/lib/api-types";
import { useRoundAdmin } from "~/hooks/use-round-admin";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { useWallet } from "~/context/wallet";
import { liveConnector } from "~/lib/wallet-store";
import { useEnsureVoteChain } from "~/hooks/use-vote-chain";
import type { pledgeTypedData } from "../../../../shared/vote/typed-data";
import type { Run } from "./run";
import { dropLock, takeLock } from "~/lib/signing-lock";

/** Neutral, never the vote's gold or an amber: it isn't settled until a round admin signs. */
export function AwaitingChip() {
  return (
    <span className="inline-block whitespace-nowrap rounded-full border border-white/35 px-2 py-0.5 text-[11.5px] text-white/90">
      Awaiting signature
    </span>
  );
}

/** A pledge's status as a held change shows it: the word when it isn't "pledged". */
export const statusWord = (s: string | null): string | null =>
  s === "received" ? "Received" : s === "withdrawn" ? "Withdrawn" : null;

/** A held request whose last signed send failed, with the reason it was given. */
export function LastTryFailed({ reason }: { reason: string }) {
  return <span className="small text-[#ffb3b1]">Last try failed: {reason}</span>;
}

type PledgeTyped = ReturnType<typeof pledgeTypedData>;
/** The API's typed data: the message's numbers as decimal strings. */
export type PreparedPledge = {
  pid: string;
  typedData: Omit<PledgeTyped, "message"> & { message: Record<string, string> };
};

/** Numbers each form send, for its hold on the signing lock. */
let sends = 0;
export const LOCKED = "Another pledge is being signed. Send this one once it's done.";

/** A table row whose change was sent on-chain and hasn't landed yet. */
const RECORDING_ROW = "Recording on-chain…";
/** How long the browser waits for a pledge's receipt, like a ballot's. */
export const RECEIPT_WAIT_MS = 3 * 60_000;
/** The round's chain (read when needed: the active round loads with the page). */
export const chainName = (round: VoteManifest): VoteChain =>
  round.chainId === MAINNET_CHAIN_ID ? "Ethereum" : "Sepolia";

export const busyOf = (e: unknown): Busy | null => {
  if (apiCode(e) !== "pledge_pending" || !(e instanceof ApiError)) return null;
  const b = e.body as { hash?: Hex | null; pid?: string };
  return typeof b.pid === "string" ? { pending: { hash: b.hash ?? null, pid: b.pid } } : null;
};

/** The connected wallet signs the API's typed data for a pledge, on the round's chain. */
export async function signPrepared(
  wallet: ReturnType<typeof useWallet>,
  ensureChain: () => Promise<void>,
  typedData: PreparedPledge["typedData"],
): Promise<Hex> {
  if (!wallet.config || !wallet.address) throw new Error("Connect your wallet first.");
  await ensureChain();
  const m = typedData.message;
  return await signTypedData(wallet.config, {
    ...typedData,
    message: {
      pledgeId: m.pledgeId as Hex,
      initiativeId: BigInt(m.initiativeId),
      currencyId: BigInt(m.currencyId),
      amount: BigInt(m.amount),
      nonce: BigInt(m.nonce),
      deadline: BigInt(m.deadline),
    },
    account: wallet.address,
    connector: liveConnector(wallet),
  } as never);
}

/**
 * Sends a pledge write. During the real vote the API answers 428 until the pledge is
 * signed: then it asks the API for the typed data, has the wallet sign it, and sends the
 * same write again with the signature. The API answers with the hash right after the
 * broadcast; the browser waits for the receipt and has the API settle it (pledge-flow.ts),
 * like a ballot. `send` resolves once saved, and throws the reason otherwise.
 */
function usePledgeSend(base: string) {
  const ROUND = useRound();
  const wallet = useWallet();
  const ensureChain = useEnsureVoteChain();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<PledgePhase>({ kind: "idle" });
  const send = useCallback(
    async (
      path: string,
      opts: ApiOptions,
      prepare: Record<string, unknown>,
      /** Told the id the pledge is signed under (a new pledge gets one here). */
      onPid?: (pid: string) => void,
    ) => {
      setPhase({ kind: "idle" });
      // The page's one signing lock (~/lib/signing-lock), taken once a signature is asked
      // for: a form save never overlaps a Sign, a Sign all or a Put on the ballot.
      const owner = `form:${base}:${++sends}`;
      const deps: PledgeFlowDeps<PreparedPledge> = {
        chain: chainName(ROUND),
        plain: async () => {
          try {
            const r = await api<{ awaiting?: boolean } | undefined>(path, opts);
            if (r && typeof r === "object" && r.awaiting === true) {
              void qc.invalidateQueries({ queryKey: ["admin"] });
              return "awaiting";
            }
            return "saved";
          } catch (e) {
            if (apiCode(e) === "signature_required") return "sign";
            // The held request changed under this one: the table shows what it is now.
            if (apiCode(e) === "pledge_request_changed") {
              void qc.invalidateQueries({ queryKey: ["admin"] });
            }
            throw e;
          }
        },
        prepare: async () => {
          if (!takeLock(owner)) throw new Error(LOCKED);
          try {
            return await api<PreparedPledge>(`${base}/pledges/prepare`, { json: prepare });
          } catch (e) {
            const busy = busyOf(e);
            if (busy) return busy;
            throw e;
          }
        },
        sign: ({ typedData }) => signPrepared(wallet, ensureChain, typedData),
        send: async ({ pid, typedData }, signature) => {
          const m = typedData.message;
          const signed = { pid, nonce: m.nonce, deadline: m.deadline, signature };
          let again: ApiOptions;
          if (opts.form) {
            const form = new FormData();
            for (const [k, v] of opts.form.entries()) form.append(k, v);
            for (const [k, v] of Object.entries(signed)) form.append(k, v);
            again = { ...opts, form };
          } else {
            again = { ...opts, json: { ...(opts.json as object | undefined), ...signed } };
          }
          try {
            const r = await api<{ hash?: Hex | null; pid?: string }>(path, again);
            // 202 `{ hash, pid }`: broadcast. Anything else: saved, no transaction needed.
            return r && "hash" in r && typeof r.pid === "string"
              ? { hash: r.hash ?? null, pid: r.pid }
              : { saved: true as const };
          } catch (e) {
            const busy = busyOf(e);
            if (busy) return busy;
            throw e;
          }
        },
        waitReceipt: async (hash) =>
          (await voteClient(ROUND).waitForTransactionReceipt({ hash, timeout: RECEIPT_WAIT_MS }))
            .status,
        settle: async (pid, hash) =>
          (await api<{ state: SettleState }>(`${base}/pledges/${pid}/settle`, {
            json: { hash },
          })).state,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      };
      let end: PledgePhase;
      try {
        end = await sendPledge(deps, setPhase, onPid);
      } finally {
        dropLock(owner);
      }
      // A transaction went out: the table shows where it stands, whatever came of it.
      if ("hash" in end && end.hash) void qc.invalidateQueries({ queryKey: ["admin"] });
      if (end.kind === "failed") throw new Error(end.reason);
      return end;
    },
    [base, wallet, ensureChain, qc, ROUND],
  );
  return { send, phase };
}

/** What the form says once a send is done, and whether it clears: a saved change that was
 * an earlier one (the API's 409) isn't the one typed, so the form keeps it, unless it was
 * this same new pledge sent again. */
export function outcomeOf(end: PledgePhase, done: string, retryOfNew: boolean) {
  if (end.kind === "awaiting") {
    return {
      text: "Saved as Awaiting signature. It counts in the vote once a round admin signs it.",
      clear: true,
    };
  }
  if ("earlier" in end && end.earlier && !retryOfNew) {
    return {
      text:
        "An earlier change to this pledge was just recorded. Check the table and send yours again if it’s still needed.",
      clear: false,
    };
  }
  return { text: end.kind === "recorded" ? end.reason : done, clear: true };
}

/** Where an on-chain pledge's send stands, in the ballot's words: one line, and the
 * transaction once there is one. Nothing outside the vote. */
export function PledgeSendStatus({ phase }: { phase: PledgePhase }) {
  const ROUND = useRound();
  const tx = "hash" in phase && phase.hash ? phase.hash : undefined;
  let text: string | null = null;
  if (phase.kind === "signing") {
    text = "Sign the pledge in your wallet. It’s a signature, not a payment.";
  } else if (phase.kind === "waiting" && phase.earlier) {
    text = `An earlier change to this pledge is on its way: waiting for ${
      chainName(ROUND)
    } to record it. Yours wasn’t sent.`;
  } else if (phase.kind === "relaying" || phase.kind === "waiting") {
    text = `Waiting for ${chainName(ROUND)} to record it. Usually under a minute.`;
  } else if (phase.kind === "failed" && tx && phase.reason === TOO_LONG) {
    text = `${
      chainName(ROUND)
    } is taking long. It was sent and may still land; the table shows it once it does.`;
  } else if (phase.kind === "failed" && tx && phase.earlier) {
    text = `The earlier change to this pledge, not yours.`;
  } else if ((phase.kind === "saved" || phase.kind === "recorded") && tx) {
    text = phase.earlier
      ? `The earlier change to this pledge was recorded on ${chainName(ROUND)}.`
      : `Recorded on ${chainName(ROUND)}.`;
  }
  if (!text && !tx) return null;
  return (
    <p className="small dim m-0 flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
      {text && <span>{text}</span>}
      {tx && (
        <a
          href={explorerTx(tx, chainName(ROUND))}
          target="_blank"
          rel="noreferrer"
          // Without contextual alternates the font draws 0x as 0×.
          className="[font-feature-settings:'calt'_0]"
        >
          {tx.slice(0, 6)}…{tx.slice(-4)} on {chainName(ROUND)}
        </a>
      )}
    </p>
  );
}

/** The form's text fields, for the typed data (the logo never goes on-chain). */
const fieldsOf = (form: FormData) =>
  Object.fromEntries(
    [...form.entries()].filter(([k, v]) => k !== "logo" && typeof v === "string"),
  );

/** Add or edit a pledge: the same fields either way; a new logo replaces the old one. */
export function PledgeForm(
  { base, run, editing, onDone, slug, stacked = false }: {
    base: string;
    /** The initiative's slug, for the note while it is on the ballot. */
    slug?: string;
    run: Run;
    editing: Pledge | null;
    onDone: () => void;
    /** One field per line, no panel of its own: for a narrow column (the dashboard). */
    stacked?: boolean;
  },
) {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const { send, phase } = usePledgeSend(base);
  const ROUND = useRound();
  // The API holds a save for a wallet without the pledge role (the round admin's other
  // role isn't asked): only then does the note apply, and not while the roles load.
  const { canSignPledges, loading } = useRoundAdmin();
  const showBallotNote = slug !== undefined && onBallotSlugs(ROUND).has(slug) && !loading &&
    !canSignPledges;
  // A new pledge keeps the id it was signed under until it is saved: sent again after
  // a failure, it sets the same pledge on-chain, never a second one.
  const newPid = useRef<string | undefined>(undefined);
  useEffect(() => {
    newPid.current = undefined;
  }, [base]);
  const [logoName, setLogoName] = useState("");
  // Controlled: form.reset() does not reach the custom select.
  const [status, setStatus] = useState(editing?.status ?? "pledged");
  useEffect(() => {
    ref.current?.reset();
    setLogoName("");
    setStatus(editing?.status ?? "pledged");
  }, [editing?.id]);
  return (
    <form
      ref={ref}
      className={stacked ? undefined : "panel"}
      // The server's answer renders under the form; the browser's own bubble would not match the site.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        // Sent again after a failure: a 409's earlier change is this same new pledge.
        const retryOfNew = !editing && newPid.current !== undefined;
        let clear = true;
        const req = editing
          ? send(`${base}/pledges/${editing.id}`, { method: "PATCH", form }, {
            ...fieldsOf(form),
            pid: editing.id,
          })
          : send(
            `${base}/pledges`,
            { form },
            { ...fieldsOf(form), pid: newPid.current },
            (pid) => (newPid.current = pid),
          );
        run(async () => {
          const o = outcomeOf(await req, editing ? "Pledge updated." : "Pledge added.", retryOfNew);
          clear = o.clear;
          return o.text;
        }, (text) => text)
          .then((saved) => {
            // A refused pledge keeps what was typed.
            if (!saved || !clear) return;
            newPid.current = undefined;
            ref.current?.reset();
            setLogoName("");
            setStatus("pledged");
            onDone();
          })
          .finally(() => setBusy(false));
      }}
    >
      {!stacked && (
        <span className="k">
          {editing ? `Edit the pledge from ${editing.company}` : "Add a pledge"}
        </span>
      )}
      <div
        className={cn(
          "grid gap-2.5",
          stacked ? "grid-cols-1" : "grid-cols-[1fr_140px_130px] max-[640px]:grid-cols-1",
        )}
      >
        <Input
          name="company"
          placeholder="Company *"
          maxLength={120}
          required
          defaultValue={editing?.company ?? ""}
        />
        <Input
          name="amount"
          placeholder="Amount USD *"
          inputMode="decimal"
          required
          defaultValue={editing ? String(editing.amountUsd) : ""}
        />
        <Select name="status" value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="pledged">pledged</SelectItem>
              <SelectItem value="received">received</SelectItem>
              {editing && <SelectItem value="withdrawn">withdrawn</SelectItem>}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div
        className={cn(
          "mt-2.5 grid gap-2.5",
          stacked ? "grid-cols-1" : "grid-cols-2 max-[640px]:grid-cols-1",
        )}
      >
        <Input
          name="url"
          placeholder="Link (optional)"
          maxLength={300}
          defaultValue={editing?.url ?? ""}
        />
        <Input
          name="note"
          placeholder="Note (optional)"
          maxLength={300}
          defaultValue={editing?.note ?? ""}
        />
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <Button type="submit" sm loading={busy}>{editing ? "Save pledge" : "Add pledge"}</Button>
        {editing && <Button type="button" sm variant="ghost" onClick={onDone}>Cancel</Button>}
        <label className="btn btn-ghost btn-sm cursor-pointer">
          <Upload className="size-3.5" />
          {logoName || (editing?.logoUrl ? "Replace logo" : "Logo (optional)")}
          <input
            type="file"
            name="logo"
            accept=".png,.jpg,.jpeg,.webp"
            className="sr-only"
            onChange={(e) => setLogoName(e.target.files?.[0]?.name ?? "")}
          />
        </label>
        {editing?.logoUrl && !logoName && (
          <img src={editing.logoUrl} alt="" className="h-6 rounded bg-white p-0.5" />
        )}
        {phase.kind === "idle" && !stacked && (
          <span className="small dim">PNG, JPG or WEBP; shown on the public page.</span>
        )}
      </div>
      {showBallotNote && (
        <p className="small dim m-0 mt-2.5">
          It's on the ballot: a new pledge, an amount or a status counts in the vote once a round
          admin signs it. A name, link, note or logo saves right away.
        </p>
      )}
      <div className="mt-2.5 empty:hidden">
        <PledgeSendStatus phase={phase} />
      </div>
    </form>
  );
}

const CLOSED_NOTE = "The vote has closed: save it or discard it.";

/** A row's amount: an awaiting change to what it counts on-chain shows as "from → to"
 * (a received or withdrawn pledge counts 0); otherwise the row's amount. */
function amountCell(p: Pledge, x: AwaitingPledgeJson | undefined): string {
  if (
    x?.kind === "edit" && x.fromUsd !== null && x.amountUsd !== null && x.fromUsd !== x.amountUsd
  ) {
    return `${usd(x.fromUsd)} → ${usd(x.amountUsd)}`;
  }
  return usd(p.amountUsd);
}

export default function Pledges(
  { page, base, run }: { page: AdminInitiativePage; base: string; run: Run },
) {
  const [editing, setEditing] = useState<Pledge | null>(null);
  const { send, phase } = usePledgeSend(base);
  const qc = useQueryClient();
  const awaitingAll = page.awaitingPledges ?? [];
  const awaitingOf = new Map(awaitingAll.filter((x) => x.kind !== "add").map((x) => [x.pid, x]));
  const awaitingAdds = awaitingAll.filter((x) => x.kind === "add");
  const discard = (x: AwaitingPledgeJson) =>
    run(async () => {
      try {
        await api(`${base}/pledge-requests/${x.pid}`, { method: "DELETE" });
      } finally {
        void qc.invalidateQueries({ queryKey: ["admin"] });
      }
    }, "Discarded.");
  /** Once the vote has closed: the held change saved as it is. */
  const saveNow = (x: AwaitingPledgeJson) =>
    run(async () => {
      try {
        await api(`${base}/pledge-requests/${x.pid}/save`, { json: {} });
      } finally {
        void qc.invalidateQueries({ queryKey: ["admin"] });
      }
    }, "Saved.");
  const closed = page.awaitingClosed === true;
  /** An awaiting row's actions: Discard, and Save now once the vote has closed. */
  const awaitingActions = (x: AwaitingPledgeJson) => (
    <>
      {closed && (
        <Button type="button" sm onClick={() => void saveNow(x)}>
          Save now
        </Button>
      )}
      <Button type="button" sm variant="ghost" onClick={() => void discard(x)}>
        Discard
      </Button>
    </>
  );
  /** An awaiting row's status cell: the chip, what the change is, and how it stands. */
  const awaitingStatus = (x: AwaitingPledgeJson) => {
    const word = x.kind === "remove" ? "Removal" : statusWord(x.status);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <AwaitingChip />
        {word && <span className="small dim">{word}</span>}
        {x.lastError && <LastTryFailed reason={x.lastError} />}
        {closed && <span className="small dim">{CLOSED_NOTE}</span>}
      </span>
    );
  };
  const pending = page.pendingPledges ?? [];
  const inFlight = new Set(pending.map((x) => x.pid));
  const added = pending.filter((x) =>
    x.kind === "add" && !page.pledges.some((p) => p.id === x.pid)
  );
  return (
    <>
      {page.pledges.length + added.length + awaitingAdds.length > 0 && (
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
                <tr
                  key={p.id}
                  className={cn(editing?.id === p.id && "[&>td]:bg-[rgba(92,183,90,.08)]")}
                >
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
                  <td className="amt">{amountCell(p, awaitingOf.get(p.id))}</td>
                  <td>
                    {awaitingOf.has(p.id)
                      ? awaitingStatus(awaitingOf.get(p.id)!)
                      : inFlight.has(p.id)
                      ? <span className="small dim">{RECORDING_ROW}</span>
                      : (
                        <Select
                          value={p.status}
                          onValueChange={(status) =>
                            run(async () =>
                              outcomeOf(
                                await send(`${base}/pledges/${p.id}`, {
                                  method: "PATCH",
                                  json: { status },
                                }, { pid: p.id, status }),
                                "",
                                false,
                              ).text, (text) => text)}
                        >
                          <SelectTrigger size="sm" aria-label={`Status of ${p.company}'s pledge`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {["pledged", "received", "withdrawn"].map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                  </td>
                  <td className="small dim">{p.note}</td>
                  <td className="whitespace-nowrap text-right">
                    {awaitingOf.has(p.id) && awaitingActions(awaitingOf.get(p.id)!)}
                    {!inFlight.has(p.id) && !awaitingOf.has(p.id) && (
                      <>
                        <button
                          type="button"
                          className="cursor-pointer rounded-[9px] border border-transparent bg-transparent p-1.5 text-muted hover:border-[rgba(92,183,90,.5)] hover:text-dao-green"
                          title="Edit pledge"
                          onClick={() => setEditing(p)}
                        >
                          <PencilLine className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-[9px] border border-transparent bg-transparent p-1.5 text-[#ffb3b1] hover:border-[rgba(255,59,56,.6)]"
                          title="Delete pledge"
                          onClick={() =>
                            confirm(`Delete the pledge from ${p.company}?`) &&
                            run(
                              async () =>
                                outcomeOf(
                                  await send(`${base}/pledges/${p.id}`, { method: "DELETE" }, {
                                    pid: p.id,
                                    remove: true,
                                  }),
                                  "Pledge deleted.",
                                  false,
                                ).text,
                              (text) => text,
                            )}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {awaitingAdds.map((x) => (
                <tr key={x.pid}>
                  <td>{x.company}</td>
                  <td className="amt">{x.amountUsd === null ? "" : usd(x.amountUsd)}</td>
                  <td>{awaitingStatus(x)}</td>
                  <td></td>
                  <td className="whitespace-nowrap text-right">{awaitingActions(x)}</td>
                </tr>
              ))}
              {added.map((x) => (
                <tr key={x.pid}>
                  <td>{x.company}</td>
                  <td className="amt">{x.amountUsd === null ? "" : usd(x.amountUsd)}</td>
                  <td>
                    <span className="small dim">{RECORDING_ROW}</span>
                  </td>
                  <td></td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mb-3.5 empty:hidden">
        <PledgeSendStatus phase={phase} />
      </div>
      <PledgeForm
        base={base}
        run={run}
        editing={editing}
        slug={page.initiative.slug}
        onDone={() => setEditing(null)}
      />
    </>
  );
}
