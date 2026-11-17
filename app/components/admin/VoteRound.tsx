import { loadRound, useRound, useVoteApi, useVoteEnvironment } from "~/lib/vote-round";
import VoteCorrections from "./VoteCorrections";
import { useEffect, useId, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@base-ui/react/switch";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { errorMessage } from "~/lib/api";
import { dayTime, usdShort } from "~/lib/format";
import { cn } from "~/lib/utils";
import { PledgeForm } from "~/components/admin/initiative/Pledges";
import InitiativeCombobox from "~/components/ui/InitiativeCombobox";
import { useRun } from "~/components/admin/dashboard/run";
import { useBoard } from "~/hooks/use-board";
import { explorerTx } from "~/components/vote/BallotStatus";

import { type Tier, tierName } from "../../../shared/vote/ballot";
import { voteFilePrefix } from "../../../shared/vote/environment";

type Brief = {
  kind: "test" | "real";
  chainId: number;
  contract: string;
  opensAt: number;
  closesAt: number;
  firstTallyAt: number;
  projects: number;
  poolUsd: string;
};
export type VoteRoundJson = {
  round: (Brief & { at: number; by: string }) | null;
  pool: { eth: number; sold: boolean } | null;
  warnings?: string[];
};

export const voteRoundKey = ["admin", "vote-round"] as const;

const CARD = "rounded-2xl border border-edge bg-card px-[18px] py-4";
const TITLE = "block font-inter-tight text-[14px] font-semibold";
const HINT = "block text-[12px] text-muted";
const FIELD =
  "w-full rounded-lg border border-edge2 bg-white/5 px-2.5 py-1.5 font-mono text-[13px] text-white outline-none focus:border-[rgba(92,183,90,.6)] aria-[invalid=true]:border-dao-red";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const chainName = (id: number) => (id === 1 ? "Ethereum" : "Sepolia");

/** Hands an admin batch to the browser as a file, for the Transaction Builder. */
function downloadBatch(batch: unknown, name: string) {
  const blob = new Blob([JSON.stringify(batch, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RoundLine({ b }: { b: Brief }) {
  return (
    <span className="mt-1 block text-[12px] text-muted">
      {b.kind === "real" ? "Real vote" : "Test vote"} on {chainName(b.chainId)} · {b.projects}{" "}
      initiatives · {usdShort(Number(BigInt(b.poolUsd) / 1_000_000n))} pool · opens{" "}
      {dayTime(b.opensAt)} · S-Tier first tally {dayTime(b.firstTallyAt)}
      <span className="block break-all font-mono">{b.contract}</span>
    </span>
  );
}

/**
 * Admin → Vote: which round the site runs, read from its contract address (a test round
 * on Sepolia, the real vote on Ethereum), and the pool's ETH while it waits to be sold.
 */
export default function VoteRound() {
  const api = useVoteApi();
  const env = useVoteEnvironment();
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const ids = useId();
  const { data } = useQuery({
    queryKey: [env, ...voteRoundKey],
    queryFn: ({ signal }) => api<VoteRoundJson>("/api/admin/vote-round", { signal }),
  });
  const [contract, setContract] = useState("");
  const [chain, setChain] = useState<"sepolia" | "ethereum">(
    env === "test" ? "sepolia" : "ethereum",
  );
  const [eth, setEth] = useState("");
  const [sold, setSold] = useState(false);
  const [busy, setBusy] = useState<"add" | "remove" | "pool" | null>(null);
  const [roundMsg, setRoundMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [poolMsg, setPoolMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setContract((c) => c || data.round?.contract || "");
    if (data.round) setChain(data.round.chainId === 1 ? "ethereum" : "sepolia");
    setEth(data.pool ? String(data.pool.eth) : "");
    setSold(data.pool?.sold ?? false);
  }, [data]);

  const contractBad = contract.trim() !== "" && !ADDRESS.test(contract.trim());
  const canAdd = ADDRESS.test(contract.trim());
  const ethNum = Number(eth.replace(/[\s,]/g, ""));
  const ethBad = eth.trim() !== "" && !(Number.isFinite(ethNum) && ethNum > 0);
  const poolDirty = Boolean(data) &&
    ((eth.trim() === "" ? null : ethNum) !== (data!.pool?.eth ?? null) ||
      sold !== (data!.pool?.sold ?? false));

  const run = async <T,>(
    what: "add" | "remove" | "pool",
    call: () => Promise<VoteRoundJson>,
    done: (r: VoteRoundJson) => T,
    setMsg: (m: { ok: boolean; text: string } | null) => void,
  ) => {
    setBusy(what);
    setMsg(null);
    try {
      const r = await call();
      qc.setQueryData([env, ...voteRoundKey], r);
      void qc.invalidateQueries({
        queryKey: [env, ...voteRoundKey],
        predicate: (q) => q.queryKey.length > voteRoundKey.length + 1,
      });
      void qc.invalidateQueries({ queryKey: [env, "admin", "vote-relayer"] });
      if (what !== "pool") void loadRound(env);
      done(r);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, "Not saved. Try again.") });
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run("add", () =>
      adminApi<VoteRoundJson>("/api/admin/vote-round/round", {
        json: { contract: contract.trim(), chain },
      }), (r) => {
      setWarnings(r.warnings ?? []);
      setRoundMsg({ ok: true, text: "This vote uses the round within a few seconds." });
    }, setRoundMsg);
  const remove = () =>
    run(
      "remove",
      () => adminApi<VoteRoundJson>("/api/admin/vote-round/round", { method: "DELETE", json: {} }),
      () => {
        setWarnings([]);
        setContract("");
        setRoundMsg({ ok: true, text: "This vote is now unavailable." });
      },
      setRoundMsg,
    );
  const savePool = () =>
    run("pool", () =>
      adminApi<VoteRoundJson>("/api/admin/vote-round/pool", {
        json: { eth: eth.trim() === "" ? null : ethNum, sold },
      }), () =>
      setPoolMsg({ ok: true, text: "Saved. Pages say it on their next load." }), setPoolMsg);

  const set = data?.round ?? null;
  const same = Boolean(set) && set!.contract.toLowerCase() === contract.trim().toLowerCase() &&
    (set!.chainId === 1) === (chain === "ethereum");
  // The real vote's round is fixed while it's open: read it again, nothing else.
  const nowSecs = Date.now() / 1000;
  const realOpen = set?.kind === "real" && nowSecs >= set.opensAt && nowSecs < set.closesAt;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* The round: read from its contract, on Sepolia or Ethereum. */}
      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) void add();
        }}
      >
        <b className={TITLE}>The round for this vote</b>
        {data && (set
          ? <RoundLine b={set} />
          : <small className={HINT}>No round configured for this vote.</small>)}

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Network">
          {([["sepolia", "Sepolia (test vote)"], ["ethereum", "Ethereum (the real vote)"]] as const)
            .filter(([k]) => k === (env === "test" ? "sepolia" : "ethereum"))
            .map(([k, label]) => (
              <Button
                key={k}
                sm
                type="button"
                variant={chain === k ? "primary" : "ghost"}
                aria-pressed={chain === k}
                disabled={realOpen}
                onClick={() => setChain(k)}
              >
                {label}
              </Button>
            ))}
        </div>
        <div className="mt-3">
          <label className="block">
            <span className={cn(HINT, "mb-1")}>Round contract</span>
            <input
              id={`${ids}-contract`}
              className={FIELD}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={contractBad}
              value={contract}
              disabled={realOpen}
              onChange={(e) => setContract(e.target.value)}
            />
          </label>
        </div>
        <small className={cn(HINT, "mt-2")}>
          {realOpen
            ? "The real vote is open: its round can't change until it closes. Read it again after projects or affiliations change on-chain."
            : "Dates, pool, initiatives, affiliations, currencies and (on Ethereum) the voting badge are read from the contract; each initiative is matched to the board by its account. Read it again after projects or affiliations change on-chain."}
        </small>
        <div className="mt-3 flex min-h-[34px] flex-wrap items-center gap-3">
          <Button sm type="submit" loading={busy === "add"} disabled={!canAdd || busy !== null}>
            {same ? "Read it again" : "Run this round"}
          </Button>
          {set && !realOpen && (
            <Button
              sm
              type="button"
              variant="ghost"
              loading={busy === "remove"}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              Take it off the site
            </Button>
          )}
          {roundMsg && <Status kind={roundMsg.ok ? "ok" : "err"}>{roundMsg.text}</Status>}
        </div>
        {warnings.map((w) => (
          <small key={w} className="mt-2 block text-[12px] text-[#ffb4b1]">{w}</small>
        ))}
      </form>

      {set?.kind === "test" && (
        <>
          <TestVoters />
          <TestPledge />
        </>
      )}

      {set && <Withdrawals round={set} />}
      {set && <VoteCorrections />}

      {/* The pool: ETH until it's sold, its dollars an estimate until then. */}
      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          if (poolDirty && !ethBad) void savePool();
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor={`${ids}-eth`} className={TITLE}>The pool in ETH</label>
            <small className={cn(HINT, ethBad && "text-[#ffb4b1]")}>
              {ethBad
                ? "Use an amount of ETH above 0, or leave it empty."
                : "Pages say the pool is this much ETH and its dollars an estimate, until it's sold. Empty: they show the dollars only."}
            </small>
          </div>
          <span className="relative flex-none">
            <input
              id={`${ids}-eth`}
              className="w-[132px] rounded-lg border border-edge2 bg-white/5 py-1.5 pl-2.5 pr-11 text-right font-inter-tight text-[14px] tnum text-white outline-none focus:border-[rgba(92,183,90,.6)] aria-[invalid=true]:border-dao-red"
              inputMode="decimal"
              aria-invalid={ethBad}
              value={eth}
              onChange={(e) => setEth(e.target.value)}
            />
            <span
              className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-inter-tight text-[14px] text-muted"
              aria-hidden="true"
            >
              ETH
            </span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-[220px] flex-1">
            <b className={TITLE}>Sold for dollars</b>
            <small className={HINT}>
              Once the ETH is sold, set the pool's dollars on-chain (below) before{" "}
              {tierName("S")}'s first tally{set ? ` (${dayTime(set.firstTallyAt)})` : ""}, then turn
              this on.
            </small>
          </div>
          <div className="flex flex-none items-center gap-2.5 font-inter-tight text-[13px]">
            <span className={sold ? "text-dao-green" : "text-muted"} aria-hidden="true">
              {sold ? "Sold" : "Not yet"}
            </span>
            <Switch.Root
              checked={sold}
              disabled={!data || busy !== null || eth.trim() === ""}
              onCheckedChange={setSold}
              aria-label="Sold for dollars"
              className="relative h-5 w-9 flex-none cursor-pointer rounded-full border-0 bg-white/15 p-0 transition-colors duration-150 data-[checked]:bg-dao-green data-[disabled]:cursor-default data-[disabled]:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dao-bright"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-150 data-[checked]:translate-x-[18px]" />
            </Switch.Root>
          </div>
        </div>
        <div className="mt-3 flex min-h-[34px] flex-wrap items-center gap-3">
          <Button
            sm
            type="submit"
            loading={busy === "pool"}
            disabled={!poolDirty || ethBad || busy !== null}
          >
            Save the pool
          </Button>
          {poolMsg && <Status kind={poolMsg.ok ? "ok" : "err"}>{poolMsg.text}</Status>}
        </div>
      </form>

      {set && <PoolOnChain eth={data?.pool?.eth ?? null} />}
    </div>
  );
}

type PoolUsdJson = { poolUsd: string; ethUsd: number | null; lowerUntil: number; closesAt: number };
const dollars = (n: number, cents = n % 1 !== 0) =>
  `$${
    n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })
  }`;

/**
 * The pool's dollars on the contract (#103): what each badge's share and the ballot
 * minimum (1.5x) are counted from. Beside it the saved ETH at the live price, and how far
 * the contract is from that. Setting it downloads a setPoolUsd batch for the round's
 * admin (the site never sends it); the figure here changes once it is executed. It can go
 * down until S-Tier's first tally, only up after that, and not at all once voting closes.
 */
function PoolOnChain({ eth }: { eth: number | null }) {
  const api = useVoteApi();
  const env = useVoteEnvironment();
  const adminApi = useAdminApi();
  const id = useId();
  const { data } = useQuery({
    queryKey: [env, "admin", "vote-round", "pool-usd"],
    queryFn: ({ signal }) => api<PoolUsdJson>("/api/admin/vote-round/pool-usd", { signal }),
    refetchInterval: 15_000,
  });
  const { run, said } = useRun();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const now = Date.now() / 1000;
  const onChain = data ? Number(BigInt(data.poolUsd)) / 1e6 : null;
  const estimate = data?.ethUsd != null && eth != null ? Math.round(eth * data.ethUsd) : null;
  const drift = onChain != null && estimate ? (onChain - estimate) / estimate : null;
  const closed = data ? now >= data.closesAt : false;
  const onlyUp = data ? now >= data.lowerUntil : false;
  const typed = Number(value.replace(/[\s,$]/g, ""));
  const bad = value.trim() !== "" && !(Number.isFinite(typed) && typed >= 0);
  const tooLow = !bad && value.trim() !== "" && onlyUp && onChain != null && typed < onChain;
  const same = !bad && onChain != null && typed === onChain;
  const send = async () => {
    setSending(true);
    await run(
      async () => {
        const batch = await adminApi<unknown>("/api/admin/vote-round/pool-usd", {
          json: { usd: typed },
        });
        downloadBatch(batch, `${voteFilePrefix(env)}vote-pool-${typed}.json`);
      },
      `Batch saved for ${
        dollars(typed)
      }: import it in the Transaction Builder of the round's admin and sign it.`,
    );
    setSending(false);
  };
  return (
    <section className={CARD} aria-labelledby={`${id}-h`}>
      <b id={`${id}-h`} className={TITLE}>The pool on-chain</b>
      <small className={HINT}>
        What the contract counts each badge's share and the ballot minimum (1.5×) from. Setting it
        downloads a batch for the round's admin to sign; this updates once it is executed.
        {data && !closed && !onlyUp &&
          ` It can go up or down until ${tierName("S")}'s first tally (${
            dayTime(data.lowerUntil)
          }), only up after that.`}
      </small>
      {data && (
        <div className="mt-3 flex flex-col gap-1 text-[13px]">
          <span>
            On the contract: <b className="tnum">{dollars(onChain!)}</b>
          </span>
          <span className="text-muted">
            {eth == null
              ? "Save the pool's ETH above for a live estimate."
              : data.ethUsd == null
              ? "The ETH price can't be read right now."
              : (
                <>
                  Live estimate: {eth.toLocaleString("en-US")} ETH at {dollars(data.ethUsd, true)}:
                  {" "}
                  {dollars(estimate!)}
                  {drift != null && Math.abs(drift) >= 0.005 && (
                    <span className={Math.abs(drift) > 0.05 ? "text-[#ffb4b1]" : undefined}>
                      {` The contract is ${Math.round(Math.abs(drift) * 100)}% ${
                        drift > 0 ? "above" : "below"
                      } the live estimate.`}
                    </span>
                  )}
                </>
              )}
          </span>
        </div>
      )}
      {data && closed && (
        <p className="mt-3 mb-0 text-[13px] text-muted">
          Voting has closed; the pool can't change now.
        </p>
      )}
      {data && !closed && (
        <form
          className="mt-3 flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !bad && !tooLow && !same) void send();
          }}
        >
          <label htmlFor={`${id}-usd`} className="sr-only">New pool in dollars</label>
          <span className="relative flex-none">
            <span
              className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-inter-tight text-[14px] text-muted"
              aria-hidden="true"
            >
              $
            </span>
            <input
              id={`${id}-usd`}
              className="w-[160px] rounded-lg border border-edge2 bg-white/5 py-1.5 pl-6 pr-2.5 text-right font-inter-tight text-[14px] tnum text-white outline-none focus:border-[rgba(92,183,90,.6)] aria-[invalid=true]:border-dao-red"
              inputMode="decimal"
              aria-invalid={bad || tooLow}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </span>
          {estimate != null && (
            <Button
              sm
              type="button"
              variant="ghost"
              onClick={() => setValue(String(estimate))}
            >
              Use the estimate
            </Button>
          )}
          <Button
            sm
            type="submit"
            loading={sending}
            disabled={!value.trim() || bad || tooLow || same || sending}
          >
            Set the pool on-chain
          </Button>
          {(onlyUp || bad || same) && (
            <small className={cn(HINT, "w-full", (bad || tooLow) && "text-[#ffb4b1]")}>
              {bad
                ? "Use an amount of dollars, 0 or more."
                : same
                ? "The contract already holds that amount."
                : `${tierName("S")}'s first tally has passed: it can only go up now.`}
            </small>
          )}
        </form>
      )}
      {said}
    </section>
  );
}

type Sent = { hash: string; tokenId?: number };

/** A test round's people: a badge for their wallet (their ballot is at /vote/ballot once
 * they sign in with it), Sepolia ETH to send it themselves or donate, and TestUSD to
 * donate. The relayer sends each. */
function TestVoters() {
  const adminApi = useAdminApi();
  const ids = useId();
  const [address, setAddress] = useState("");
  const [eth, setEth] = useState("0.02");
  const [usd, setUsd] = useState("1000");
  const [busy, setBusy] = useState<"badge" | "eth" | "usd" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const to = address.trim();
  const bad = to !== "" && !ADDRESS.test(to);
  const ready = ADDRESS.test(to) && busy === null;
  const send = async (
    what: "badge" | "eth" | "usd",
    path: string,
    json: unknown,
    done: (r: Sent) => string,
  ) => {
    setBusy(what);
    setMsg(null);
    try {
      const r = await adminApi<Sent>(`/api/admin/vote-round/${path}`, { json });
      setMsg({ ok: true, text: done(r), hash: r.hash });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, "Not sent. Try again.") });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={CARD} aria-labelledby={`${ids}-title`}>
      <b id={`${ids}-title`} className={TITLE}>Test voters</b>
      <small className={HINT}>
        Give a person's wallet a test badge, Sepolia ETH or TestUSD. Simulated voters come from the
        CLI (deno task vote-sim) and need none of these.
      </small>
      <label className="mt-3 block">
        <span className={cn(HINT, "mb-1")}>Wallet address</span>
        <input
          className={FIELD}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={bad}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          sm
          type="button"
          loading={busy === "badge"}
          disabled={!ready}
          onClick={() =>
            void send(
              "badge",
              "badge",
              { address: to },
              (r) => `Badge #${r.tokenId} is on its way.`,
            )}
        >
          Give a badge
        </Button>
        <span className="flex items-center gap-1.5">
          <input
            aria-label="ETH to send"
            className={cn(FIELD, "w-[84px] text-right font-inter-tight")}
            inputMode="decimal"
            value={eth}
            onChange={(e) => setEth(e.target.value)}
          />
          <Button
            sm
            type="button"
            variant="ghost"
            loading={busy === "eth"}
            disabled={!ready}
            onClick={() =>
              void send("eth", "eth", { address: to, eth: Number(eth) }, () => `${eth} ETH sent.`)}
          >
            Send Sepolia ETH
          </Button>
        </span>
        <span className="flex items-center gap-1.5">
          <input
            aria-label="TestUSD to mint"
            className={cn(FIELD, "w-[96px] text-right font-inter-tight")}
            inputMode="numeric"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
          />
          <Button
            sm
            type="button"
            variant="ghost"
            loading={busy === "usd"}
            disabled={!ready}
            onClick={() =>
              void send(
                "usd",
                "test-usd",
                { address: to, usd: Number(usd.replace(/[\s,]/g, "")) },
                () => `${usd} TestUSD minted.`,
              )}
          >
            Mint TestUSD
          </Button>
        </span>
      </div>
      {msg && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Status kind={msg.ok ? "ok" : "err"}>{msg.text}</Status>
          {msg.hash && (
            <a
              className="text-[12px] text-muted underline"
              href={explorerTx(msg.hash)}
              target="_blank"
              rel="noreferrer"
            >
              Sepolia
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A pledge in the test round only, on Sepolia: pick an initiative of the round, then the
 * usual pledge form. Signed with the admin's wallet (it needs the round's PLEDGE_ROLE,
 * which sem-the-bee.eth has) and relayed; it lowers that initiative's ask in the test vote
 * and never reaches the site's pledges.
 */
function TestPledge() {
  const env = useVoteEnvironment();
  const ROUND = useRound();
  const id = useId();
  const board = useBoard();
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const [search, setSearch] = useState("");
  const { run, said, setMsg } = useRun();
  // The round's initiatives (its slugs), by their board titles.
  const items = useMemo(() => {
    const titles = new Map(board.data?.cards.map((c) => [c.initiative.slug, c.initiative.title]));
    return ROUND.slugs
      .map((slug) => ({ id: slug, title: titles.get(slug) ?? slug }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [board.data, ROUND]);
  return (
    <section className={CARD} aria-labelledby={`${id}-h`}>
      <b id={`${id}-h`} className={TITLE}>Test pledge</b>
      <small className={HINT}>
        A pledge to one initiative in this test round only, on Sepolia: it lowers what the
        initiative asks of the pool here, and never shows on the site. Sign with a wallet that holds
        the round's pledge role (sem-the-bee.eth).
      </small>
      <label htmlFor={id} className="mt-3 block text-[12.5px] text-white/80">Initiative</label>
      <InitiativeCombobox
        id={id}
        items={items}
        value={picked}
        onValueChange={(x) => {
          setPicked(x);
          setMsg(null);
        }}
        inputValue={search}
        onInputValueChange={setSearch}
        popupZ="z-50"
      />
      {picked && search === picked.title && (
        <div className="mt-3">
          <PledgeForm
            key={picked.id}
            base={`/api/admin/${env === "test" ? "vote-test-round" : "vote-round"}/test-pledges/${
              encodeURIComponent(picked.id)
            }`}
            run={(fn, ok) => run(fn, typeof ok === "string" ? `${ok} (${picked.title})` : ok)}
            editing={null}
            onDone={() => {}}
            stacked
          />
        </div>
      )}
      {said}
    </section>
  );
}

type Withdrawal = { slug: string; withdrawn: boolean; settledIn: Tier | null };
const withdrawalsKey = ["admin", "vote-round", "initiatives"] as const;

/**
 * Withdraw an initiative from the vote, or undo it. Each button downloads a Transaction
 * Builder batch for the round's admin to execute; the site sends nothing.
 * Once an initiative is settled in a tier it can't be withdrawn.
 */
function Withdrawals({ round }: { round: Brief }) {
  const api = useVoteApi();
  const env = useVoteEnvironment();
  const adminApi = useAdminApi();
  const id = useId();
  const board = useBoard();
  const { data } = useQuery({
    queryKey: [env, ...withdrawalsKey, round.chainId, round.contract.toLowerCase()],
    queryFn: ({ signal }) =>
      api<{ initiatives: Withdrawal[]; final?: boolean; canWithdraw?: boolean }>(
        "/api/admin/vote-round/initiatives",
        { signal },
      ),
    refetchInterval: 15_000,
  });
  const { run, said } = useRun();
  const titles = useMemo(
    () => new Map(board.data?.cards.map((c) => [c.initiative.slug, c.initiative.title])),
    [board.data],
  );
  const rows = useMemo(
    () =>
      (data?.initiatives ?? [])
        .map((x) => ({ ...x, title: titles.get(x.slug) ?? x.slug }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [data, titles],
  );
  const send = (x: Withdrawal, title: string) =>
    run(async () => {
      const batch = await adminApi<unknown>("/api/admin/vote-round/withdraw", {
        json: { slug: x.slug, withdrawn: !x.withdrawn },
      });
      downloadBatch(
        batch,
        `${voteFilePrefix(env)}vote-${x.withdrawn ? "undo-withdraw" : "withdraw"}-${x.slug}.json`,
      );
    }, `Batch saved for ${title}: execute it with the round's admin account.`);
  return (
    <section className={CARD} aria-labelledby={`${id}-h`}>
      <b id={`${id}-h`} className={TITLE}>Withdraw from the vote</b>
      <small className={HINT}>
        A withdrawn initiative is not a candidate in any tier. Only the round's admin can execute
        withdrawals. This downloads a transaction batch, and the list updates after it is executed.
        Not possible once an initiative is settled in a tier.
      </small>
      {data?.canWithdraw === false
        ? (
          <p className="mt-3 text-[13px] text-muted">
            This round's contract predates withdrawals: nothing can be withdrawn from it.
          </p>
        )
        : data?.final
        ? (
          <p className="mt-3 text-[13px] text-muted">
            Every tier has settled: the vote's tally is final, nothing to withdraw from.
          </p>
        )
        : (
          <ul className="mt-3 flex list-none flex-col gap-2 p-0">
            {rows.map((x) => (
              <li key={x.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-[160px] flex-1 text-[13px]">{x.title}</span>
                {x.withdrawn && <span className="text-[12px] text-dao-red-pale">Withdrawn</span>}
                {x.settledIn && (
                  <span className="text-[12px] text-muted">
                    Settled in {tierName(x.settledIn)}: it can't be withdrawn.
                  </span>
                )}
                <Button
                  sm
                  type="button"
                  variant="ghost"
                  disabled={Boolean(x.settledIn)}
                  onClick={() =>
                    void send(x, x.title)}
                >
                  {x.withdrawn ? "Undo withdrawal" : "Withdraw from the vote"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      {said}
    </section>
  );
}
