import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Landmark, Wallet } from "lucide-react";
import { useWallet, useWalletStore } from "~/context/wallet";
import { useDonateParams } from "~/hooks/use-donate-params";
import { TERMS } from "~/data/terms";
import GovernedBy from "~/components/terms/GovernedBy";
import type { DonateResult } from "~/lib/api-types";
import { parseUsd, tokenQty } from "~/lib/donate";
import { cn } from "~/lib/utils";
import Status from "~/components/ui/Status";
import { Button } from "~/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { errorMessage } from "~/lib/api";
import { useDonation } from "./useDonation";
import Reveal from "~/components/ui/Reveal";
import { WALLETCONNECT_PROJECT_ID } from "~/lib/wallet-env";

const CHIPS = ["50", "500", "5000", "50000"];
type Method = "wallet" | "exchange";

/** The donate widget: chips, $ amount, token, wallet / exchange tabs. */
export default function DonateWidget({
  initiativeId,
  slug,
  safeAddress,
  onConfirmed,
}: {
  initiativeId: string;
  slug: string;
  safeAddress: string;
  onConfirmed?: (r: DonateResult) => void;
}) {
  const { data: params } = useDonateParams();
  const { address, connector } = useWallet();
  const wallet = useWalletStore();
  // The Donate panel is where a wallet gets used: fetch the wallet stack now.
  useEffect(() => {
    void wallet.load().catch(() => {});
  }, [wallet]);
  const [accepted, setAccepted] = useState(false);
  const [exchangeAttempt, setExchangeAttempt] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [name, setName] = useState("");
  const [exchangeAmount, setExchangeAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [txHash, setTxHash] = useState("");
  const d = useDonation({ initiativeId, slug, safeAddress, params, onConfirmed, accepted });
  const toggleTerms = (on: boolean) => {
    setAccepted(on);
    setExchangeAttempt(null);
  };
  useEffect(() => {
    setAccepted(false);
    setExchangeAttempt(null);
  }, [initiativeId, safeAddress]);
  const revealAddress = async () => {
    if (!accepted || recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    try {
      const receipt = await d.recordAcceptance("exchange", {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(exchangeAmount.trim() ? { amount: exchangeAmount.trim() } : {}),
        ...(currency ? { currency } : {}),
      });
      setExchangeAttempt(receipt.attemptId);
      d.setStatus(null);
    } catch (error) {
      d.setStatus({ kind: "err", text: errorMessage(error) });
    } finally {
      recordingRef.current = false;
      setRecording(false);
    }
  };
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

  // The answer to a button shows under that button: before the address is
  // revealed that is the "Show donation address" button, not the widget's foot.
  const statusBox = d.status && <Status kind={d.status.kind}>{d.status.text}</Status>;
  const underReveal = method === "exchange" && !exchangeAttempt;

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
  // No wallet in this browser: lead with the exchange tab.
  useEffect(() => {
    const hasInjected = typeof window !== "undefined" &&
      Boolean((window as { ethereum?: unknown }).ethereum);
    if (!hasInjected && !WALLETCONNECT_PROJECT_ID && !connector) {
      setMethod("exchange");
    }
  }, [connector]);

  const rate = params?.enabled ? params.rates[symbol] || 1 : 1;
  const usd = parseUsd(amount);
  // The trigger shows the bare symbol (it is 110px wide); the list adds the balance.
  const tokenItems = (tokens.length ? tokens : ["USDC"]).map((t) => ({
    value: t,
    label: typeof balances[t] === "number" && balances[t]! > 0
      ? `${t} (${balances[t]!.toFixed(2)})`
      : t,
  }));
  const currencyItems = [
    { value: "", label: "Not specified" },
    ...tokens.map((t) => ({ value: t, label: t })),
  ];
  const conv = params?.enabled && params.tokens[symbol] && usd > 0 && rate !== 1
    ? `≈ ${tokenQty(usd, rate, params.tokens[symbol].decimals)} ${symbol} · ${
      rate >= 10 ? "$" + Math.round(rate).toLocaleString() : "$" + rate.toFixed(2)
    } per ${symbol}`
    : null;

  const methods: { id: Method; label: string; icon: React.ReactNode }[] = [
    { id: "wallet", label: "Wallet", icon: <Wallet className="size-[15px]" /> },
    { id: "exchange", label: "Exchange", icon: <Landmark className="size-[15px]" /> },
  ];

  const copy = () => {
    if (!gated() || !exchangeAttempt) return;
    navigator.clipboard.writeText(safeAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() =>
      d.setStatus({ kind: "err", text: "Copy failed. The address is: " + safeAddress })
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Each Reveal carries its own gap as padding and cancels the column's, so a closed one takes no room. */}
      <Reveal show={method === "wallet"} className="-mb-2.5">
        <div className="flex flex-col gap-2.5 pb-2.5">
          {/* The four amounts share one row, in equal columns. */}
          <div className="grid grid-cols-4 gap-1.5">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  "cursor-pointer whitespace-nowrap rounded-full border px-1 py-2 text-center font-inter-tight text-[13px] transition-all duration-150 max-[760px]:py-[11px]",
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
              <span className="flex-none font-inter-tight text-[14px] font-light text-muted">
                $
              </span>
              <input
                className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 pr-3.5 font-inter-tight text-[14px] font-light text-white outline-none placeholder:text-white/35"
                inputMode="decimal"
                placeholder="Custom amount"
                aria-label="Amount in US dollars"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <Select
              value={symbol}
              onValueChange={(v) => setSymbol(v as string)}
            >
              <SelectTrigger
                className="w-[110px] flex-none py-2.5 pl-3 pr-2"
                aria-label="Donation token"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {tokenItems.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {conv && <p className="-mt-0.5 ml-0.5 m-0 small dim">{conv}</p>}
        </div>
      </Reveal>

      <label className="my-0.5 flex cursor-pointer items-center gap-2 small text-soft">
        <input
          type="checkbox"
          className="size-4"
          checked={accepted}
          disabled={recording || Boolean(d.busy)}
          onChange={(e) => toggleTerms(e.target.checked)}
        />
        <span>
          I agree to these{" "}
          <Link
            to={`/donation-terms/v/${TERMS.id}`}
            target="_blank"
            rel="noopener"
            className="underline"
          >
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
            disabled={recording || Boolean(d.busy)}
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

      <Reveal show={method === "wallet"} className="-mt-2.5">
        <div className="flex flex-col pt-2.5">
          <Button
            variant="primary"
            onClick={async () => {
              if (gated()) {
                if (await d.donate(symbol, amount, balances)) setAccepted(false);
              }
            }}
            disabled={Boolean(d.busy) || !accepted}
          >
            {d.busy ?? "Donate"}
          </Button>
        </div>
      </Reveal>
      <Reveal show={method === "exchange"} className="-mt-2.5">
        <div className="flex flex-col gap-2 pt-2.5">
          <p className="m-0 small dim">
            Send from an exchange or another wallet to the address below. It shows up on this page
            on its own, usually within a few minutes.
          </p>
          <ul className="m-0 small dim list-disc pl-4 [&>li+li]:mt-1">
            <li>
              <b className="text-white">Network: Ethereum Mainnet only.</b>{" "}
              Exchanges call it "Ethereum", "ETH" or "ERC-20". Not Arbitrum, Optimism, Base,
              Polygon, BNB Smart Chain (BEP-20), Tron (TRC-20) or Solana: funds sent on another
              network cannot be recovered.
            </li>
            <li>
              <b className="text-white">Tokens:</b> {params?.enabled
                ? Object.keys(params.tokens).join(", ")
                : "an accepted stablecoin or ETH"}. Anything else is not counted.
            </li>
            <li>
              No memo or destination tag. If the withdrawal form asks for one, the network is wrong.
            </li>
            <li>
              Sending a large amount? Send a small one first, wait for it to appear here, then send
              the rest.
            </li>
          </ul>
          <Reveal show={!exchangeAttempt} className="-mb-2">
            <div className="flex flex-col gap-2 pb-2">
              <p className="m-0 small dim">
                Optional details to help us match your deposit. You can leave all fields blank.
              </p>
              <label className="flex flex-col gap-1 small">
                Name (optional)
                <input
                  className="field"
                  autoComplete="name"
                  maxLength={120}
                  value={name}
                  disabled={recording}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 small">
                  Amount (optional)
                  <input
                    className="field w-full"
                    inputMode="decimal"
                    maxLength={80}
                    value={exchangeAmount}
                    disabled={recording}
                    onChange={(e) => setExchangeAmount(e.target.value)}
                  />
                </label>
                <div className="flex flex-col gap-1 small">
                  <label htmlFor="exchange-currency">Currency (optional)</label>
                  <Select
                    id="exchange-currency"
                    items={currencyItems}
                    value={currency}
                    disabled={recording}
                    onValueChange={(v) => setCurrency(v as string)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {currencyItems.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="primary" onClick={revealAddress} disabled={!accepted || recording}>
                {recording ? "Recording agreement…" : "Show donation address"}
              </Button>
              {statusBox}
            </div>
          </Reveal>
          <span className="k">Ethereum Mainnet (ERC-20) address</span>
          <div className="flex items-center gap-2 rounded-[14px] border border-edge bg-black/15 px-3 py-2">
            <span
              className="mono min-w-0 flex-1 text-[11.5px] [overflow-wrap:anywhere]"
              data-address={exchangeAttempt ? safeAddress : undefined}
            >
              {accepted && exchangeAttempt ? safeAddress : "0x····…····"}
            </span>
            <Button
              variant="ghost"
              sm
              className="m-0 flex-none"
              onClick={copy}
              disabled={!accepted || !exchangeAttempt}
            >
              {copied ? "Copied ✓" : "Copy"}
            </Button>
          </div>
          <Reveal show={Boolean(exchangeAttempt)} className="-mt-2">
            <div className="flex flex-col gap-2 pt-2">
              <label className="flex flex-col gap-1 small">
                Transaction hash after withdrawal (optional)
                <input
                  className="field"
                  placeholder="0x…"
                  maxLength={66}
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                />
              </label>
              <Button
                variant="ghost"
                disabled={Boolean(d.busy) || !/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())}
                onClick={() =>
                  d.confirmTx(txHash.trim().toLowerCase(), exchangeAttempt ?? undefined)}
              >
                {d.busy ?? "Match my deposit"}
              </Button>
              <p className="m-0 small dim">
                These details stay private. A transaction hash helps us identify the deposit.
              </p>
            </div>
          </Reveal>
          <GovernedBy />
        </div>
      </Reveal>

      {!underReveal && statusBox}
    </div>
  );
}
