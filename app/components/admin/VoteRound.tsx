import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@base-ui/react/switch";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { api, errorMessage } from "~/lib/api";
import { dayTime, usdShort } from "~/lib/format";
import { cn } from "~/lib/utils";

type Brief = {
  kind: "test" | "real";
  chainId: number;
  contract: string;
  issuer: string | null;
  opensAt: number;
  closesAt: number;
  firstTallyAt: number;
  projects: number;
  poolUsd: string;
};
export type VoteRoundJson = {
  built: Brief | null;
  test: (Brief & { at: number; by: string }) | null;
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
 * Admin → Vote: which round the site runs (the one built in, or a Sepolia test round
 * read from its contract address), and the pool's ETH while it waits to be sold.
 */
export default function VoteRound() {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const ids = useId();
  const { data } = useQuery({
    queryKey: voteRoundKey,
    queryFn: ({ signal }) => api<VoteRoundJson>("/api/admin/vote-round", { signal }),
  });
  const [contract, setContract] = useState("");
  const [issuer, setIssuer] = useState("");
  const [eth, setEth] = useState("");
  const [sold, setSold] = useState(false);
  const [busy, setBusy] = useState<"add" | "remove" | "pool" | null>(null);
  const [roundMsg, setRoundMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [poolMsg, setPoolMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setContract((c) => c || data.test?.contract || "");
    setIssuer((i) => i || data.test?.issuer || data.built?.issuer || "");
    setEth(data.pool ? String(data.pool.eth) : "");
    setSold(data.pool?.sold ?? false);
  }, [data]);

  const contractBad = contract.trim() !== "" && !ADDRESS.test(contract.trim());
  const issuerBad = issuer.trim() !== "" && !ADDRESS.test(issuer.trim());
  const canAdd = ADDRESS.test(contract.trim()) && ADDRESS.test(issuer.trim());
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
      qc.setQueryData(voteRoundKey, r);
      void qc.invalidateQueries({ queryKey: ["admin", "vote-relayer"] });
      done(r);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, "Not saved. Try again.") });
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run("add", () =>
      adminApi<VoteRoundJson>("/api/admin/vote-round/test", {
        json: { contract: contract.trim(), issuer: issuer.trim() },
      }), (r) => {
      setWarnings(r.warnings ?? []);
      setRoundMsg({ ok: true, text: "The site runs this round within a few seconds." });
    }, setRoundMsg);
  const remove = () =>
    run(
      "remove",
      () => adminApi<VoteRoundJson>("/api/admin/vote-round/test", { method: "DELETE", json: {} }),
      () => {
        setWarnings([]);
        setContract("");
        setRoundMsg({ ok: true, text: "Back to the round built into the site." });
      },
      setRoundMsg,
    );
  const savePool = () =>
    run("pool", () =>
      adminApi<VoteRoundJson>("/api/admin/vote-round/pool", {
        json: { eth: eth.trim() === "" ? null : ethNum, sold },
      }), () =>
      setPoolMsg({ ok: true, text: "Saved. Pages say it on their next load." }), setPoolMsg);

  const test = data?.test;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* The round: built in, or a test round read from Sepolia. */}
      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) void add();
        }}
      >
        <b className={TITLE}>The round the site runs</b>
        {data && (test
          ? (
            <>
              <small className={HINT}>
                A test round added by an admin, in place of the one built into the site.
              </small>
              <RoundLine b={test} />
            </>
          )
          : data.built
          ? (
            <>
              <small className={HINT}>The round built into the site.</small>
              <RoundLine b={data.built} />
            </>
          )
          : <small className={HINT}>None: no vote is deployed.</small>)}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={cn(HINT, "mb-1")}>Test round contract on Sepolia</span>
            <input
              id={`${ids}-contract`}
              className={FIELD}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={contractBad}
              value={contract}
              onChange={(e) => setContract(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={cn(HINT, "mb-1")}>Paper-code issuer</span>
            <input
              id={`${ids}-issuer`}
              className={FIELD}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={issuerBad}
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
            />
          </label>
        </div>
        <small className={cn(HINT, "mt-2")}>
          Dates, pool, initiatives, affiliations and currencies are read from the contract; each
          initiative is matched to the board by its account. Add it again after projects or
          affiliations change on-chain.
        </small>
        <div className="mt-3 flex min-h-[34px] flex-wrap items-center gap-3">
          <Button sm type="submit" loading={busy === "add"} disabled={!canAdd || busy !== null}>
            {test && test.contract.toLowerCase() === contract.trim().toLowerCase()
              ? "Read it again"
              : "Run this test round"}
          </Button>
          {test && (
            <Button
              sm
              type="button"
              variant="ghost"
              loading={busy === "remove"}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              Back to the built-in round
            </Button>
          )}
          {roundMsg && <Status kind={roundMsg.ok ? "ok" : "err"}>{roundMsg.text}</Status>}
        </div>
        {warnings.map((w) => (
          <small key={w} className="mt-2 block text-[12px] text-[#ffb4b1]">{w}</small>
        ))}
      </form>

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
              Once the ETH is sold, set the pool's dollars on-chain (setPoolUsd) before the S-Tier
              first tally{data?.test || data?.built
                ? ` (${dayTime((data.test ?? data.built)!.firstTallyAt)})`
                : ""}, then turn this on.
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
    </div>
  );
}
