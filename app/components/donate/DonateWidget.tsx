import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { CreditCard, Landmark, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useDonateParams } from "~/hooks/use-donate-params";
import { TERMS } from "~/data/terms";
import GovernedBy from "~/components/terms/GovernedBy";
import type { DonateResult, Onramp } from "~/lib/api-types";
import { parseUsd, tokenQty } from "~/lib/donate";
import { cn } from "~/lib/utils";
import Status from "~/components/ui/Status";
import { Button } from "~/components/ui/Button";
import { useDonation } from "./useDonation";
import { WALLETCONNECT_PROJECT_ID } from "~/lib/wagmi";

const CHIPS = ["50", "500", "5000", "50000"];
type Method = "wallet" | "card" | "exchange";

/**
 * Acceptance is remembered per terms version id as the ISO time of the tick,
 * so every new version re-asks. Older values ("1") never match.
 */
const termsKey = (id: string) => "thedao:terms:" + id;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
function readAcceptedAt(id: string): string | null {
  try {
    const v = id ? localStorage.getItem(termsKey(id)) : null;
    return v && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}

/** The MVP's donate widget: chips, $ amount, token, wallet / card / exchange tabs. */
export default function DonateWidget({
  initiativeId,
  slug,
  safeAddress,
  onramp,
  onConfirmed,
}: {
  initiativeId: string;
  slug: string;
  safeAddress: string;
  onramp?: Onramp;
  onConfirmed?: (r: DonateResult) => void;
}) {
  const { data: params } = useDonateParams();
  const { address, connector } = useAccount();
  // ---- donation terms gate: every method stays locked until the box is checked.
  // The tick time rides along with the donation confirm, where the API writes
  // one acceptance record per transaction (see api/db/terms.ts).
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const accepted = acceptedAt !== null;
  useEffect(() => {
    setAcceptedAt(readAcceptedAt(TERMS.id));
  }, []);
  const toggleTerms = (on: boolean) => {
    const at = on ? new Date().toISOString() : null;
    setAcceptedAt(at);
    try {
      if (at) localStorage.setItem(termsKey(TERMS.id), at);
      else localStorage.removeItem(termsKey(TERMS.id));
    } catch { /* private mode: the gate still works for this page view */ }
  };
  const d = useDonation({ initiativeId, slug, safeAddress, params, onConfirmed, acceptedAt });
  const [amount, setAmount] = useState("");
  const [symbol, setSymbol] = useState("");
  const [method, setMethod] = useState<Method>("wallet");
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [copied, setCopied] = useState(false);

  const gated = () => {
    if (accepted) return true;
    d.setStatus({ kind: "err", text: "Please agree to the donation terms first." });
    return false;
  };

  const tokens = useMemo(() => (params?.enabled ? Object.keys(params.tokens) : []), [params]);
  useEffect(() => {
    if (tokens.length && !tokens.includes(symbol)) {
      setSymbol(tokens.includes("USDC") ? "USDC" : tokens[0]);
    }
  }, [tokens, symbol]);
  useEffect(() => {
    if (!address) {
      setBalances({});
      return;
    }
    let live = true;
    d.loadBalances().then((b) => live && setBalances(b));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, params]);
  // No wallet in this browser: lead with card if available, else exchange.
  useEffect(() => {
    const hasInjected = typeof window !== "undefined" &&
      Boolean((window as { ethereum?: unknown }).ethereum);
    if (!hasInjected && !WALLETCONNECT_PROJECT_ID && !connector) {
      setMethod(onramp?.prefilled ? "card" : "exchange");
    }
  }, [connector, onramp?.prefilled]);

  const rate = params?.enabled ? params.rates[symbol] || 1 : 1;
  const usd = parseUsd(amount);
  const conv = params?.enabled && params.tokens[symbol] && usd > 0 && rate !== 1
    ? `≈ ${tokenQty(usd, rate, params.tokens[symbol].decimals)} ${symbol} · ${
      rate >= 10 ? "$" + Math.round(rate).toLocaleString() : "$" + rate.toFixed(2)
    } per ${symbol}`
    : null;

  const methods: { id: Method; label: string; icon: React.ReactNode }[] = [
    { id: "wallet", label: "Wallet", icon: <Wallet className="size-[15px]" /> },
    ...(onramp?.prefilled
      ? [{ id: "card" as Method, label: "Card", icon: <CreditCard className="size-[15px]" /> }]
      : []),
    { id: "exchange", label: "Exchange", icon: <Landmark className="size-[15px]" /> },
  ];

  const copy = () => {
    if (!gated()) return;
    navigator.clipboard.writeText(safeAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() =>
      d.setStatus({ kind: "err", text: "Copy failed. The address is: " + safeAddress })
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className={cn(
              "cursor-pointer rounded-full border px-4 py-2 font-inter-tight text-[13px] transition-all duration-150 max-[760px]:px-4 max-[760px]:py-[11px]",
              amount === c
                ? "border-dao-green bg-dao-green font-medium text-white"
                : "border-edge2 bg-white/5 text-soft hover:border-[rgba(92,183,90,.6)] hover:text-dao-green",
            )}
            onClick={() => setAmount(c)}
          >
            ${Number(c).toLocaleString("en-US")}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-0.5 rounded-xl border border-edge2 bg-card pl-3.5 focus-within:border-[rgba(92,183,90,.6)]">
          <span className="flex-none font-inter-tight text-[14px] font-light text-muted">$</span>
          <input
            className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 pr-3.5 font-inter-tight text-[14px] font-light text-white outline-none placeholder:text-white/35"
            inputMode="decimal"
            placeholder="Custom amount ($1 minimum)"
            aria-label="Amount in US dollars"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <select
          className="field w-[110px] flex-none py-2.5 pl-3 pr-2"
          aria-label="Donation token"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        >
          {(tokens.length ? tokens : ["USDC"]).map((t) => (
            <option key={t} value={t}>
              {t}
              {typeof balances[t] === "number" && balances[t]! > 0
                ? ` (${balances[t]!.toFixed(2)})`
                : ""}
            </option>
          ))}
        </select>
      </div>
      {conv && <p className="-mt-0.5 ml-0.5 m-0 small dim">{conv}</p>}

      <label className="my-0.5 flex cursor-pointer items-center gap-2 small text-soft">
        <input
          type="checkbox"
          className="size-4"
          checked={accepted}
          onChange={(e) => toggleTerms(e.target.checked)}
        />
        <span>
          I agree to these{" "}
          <Link to="/donation-terms" target="_blank" rel="noopener" className="underline">
            Donation Terms
          </Link>.
        </span>
      </label>

      <div
        className="flex gap-1.5 rounded-[14px] border border-edge bg-white/[.03] p-1"
        role="group"
        aria-label="Choose how to donate"
      >
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={method === m.id}
            onClick={() => setMethod(m.id)}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border border-transparent px-1.5 py-2 font-inter-tight text-[12.5px] font-medium text-muted transition-all duration-150 hover:text-white max-[760px]:py-3",
              method === m.id &&
                "border-edge2 bg-card text-white shadow-[0_1px_6px_rgba(0,0,0,.3)]",
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {method === "wallet" && (
        <Button
          variant="primary"
          onClick={() => gated() && d.donate(symbol, amount, balances)}
          disabled={Boolean(d.busy) || !accepted}
        >
          {d.busy ?? "Donate"}
        </Button>
      )}
      {method === "card" && onramp?.prefilled && (
        <div className="flex flex-col gap-2">
          <p className="m-0 small dim">
            Buy USDC with a card (Visa, Mastercard, Apple Pay, Google Pay). It is delivered straight
            to this initiative's fund address on Ethereum mainnet, already filled in for you, and
            shows up here automatically once it lands.
          </p>
          <a
            className={cn("btn btn-primary", !accepted && "pointer-events-none opacity-40")}
            href={onramp.url.replace("{AMT}", encodeURIComponent(amount || "100"))}
            target="_blank"
            rel="noopener"
            aria-disabled={!accepted}
            onClick={(e) =>
              !gated() ? e.preventDefault() : d.setStatus({
                kind: "wait",
                text:
                  "Card checkout opened in a new tab. Your donation appears here automatically once the USDC arrives (typically a few minutes after the purchase).",
              })}
          >
            Open card checkout ↗
          </a>
        </div>
      )}
      {method === "exchange" && (
        <div className="flex flex-col gap-2">
          <p className="m-0 small dim">
            Send an accepted stablecoin or ETH from any exchange or wallet to this initiative's
            address. It shows up on this page on its own, usually within a couple of minutes.
          </p>
          <div className="flex items-center gap-2 rounded-[14px] border border-edge bg-black/15 px-3 py-2">
            <span
              className="mono min-w-0 flex-1 text-[11.5px] [overflow-wrap:anywhere]"
              data-address={safeAddress}
            >
              {accepted ? safeAddress : "0x····…····"}
            </span>
            <Button
              variant="ghost"
              sm
              className="m-0 flex-none"
              onClick={copy}
              disabled={!accepted}
            >
              {copied ? "Copied ✓" : "Copy"}
            </Button>
          </div>
          <GovernedBy />
        </div>
      )}

      {d.status && <Status kind={d.status.kind}>{d.status.text}</Status>}
    </div>
  );
}
