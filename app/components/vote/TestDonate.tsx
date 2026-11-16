import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { writeContract } from "wagmi/actions";
import { useWallet } from "~/context/wallet";
import { api } from "~/lib/api";
import { donateChips, parseUsd, walletErrorMessage } from "~/lib/donate";
import { liveConnector } from "~/lib/wallet-store";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import type { Suggestion } from "~/components/donate/DonateWidget";
import OverCap from "~/components/donate/OverCap";
import { useEnsureVoteChain } from "~/hooks/use-vote-chain";
import { voteClient } from "~/hooks/use-vote-send";
import { ROUND } from "../../../shared/vote/manifest";
import { TEST_USD_ABI, TEST_USD_MAX_MINT, testDonation } from "../../../shared/vote/test-usd";

const WAIT_MS = 3 * 60_000;

/**
 * A test round's donate form: test dollars (tUSD, Sepolia) minted straight to the
 * initiative's account, which the round counts at $1 from the next tally on. No real
 * money moves, and nothing is needed but a little Sepolia ETH for gas (a badge's one
 * gas top-up when the wallet has none).
 */
export default function TestDonate(
  { slug, suggested = [], onAmount, onDonated, badge, accent = "green", cap }: {
    slug: string;
    suggested?: Suggestion[];
    onAmount?: (usd: number) => void;
    onDonated?: () => void;
    /** The voter's badge, for the gas top-up. */
    badge?: number;
    accent?: "green" | "red";
    /** The most it can take: what the initiative still needs, as DonateWidget's. */
    cap?: Suggestion;
  },
) {
  const red = accent === "red";
  const wallet = useWallet();
  const ensureChain = useEnsureVoteChain();
  const target = testDonation(ROUND, slug);
  const first = suggested[0];
  const [amount, setAmount] = useState(first ? String(first.usd) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "wait"; text: string } | null>(
    null,
  );
  // Another initiative: start from its suggestion. For the same one the amount never moves
  // (#100): a new suggestion shows in the chips, and the preview says what the amount
  // does now. Only a form that opened before any suggestion takes the first, if empty.
  const suggestedFor = useRef({ slug, usd: first?.usd });
  useEffect(() => {
    const was = suggestedFor.current;
    suggestedFor.current = { slug, usd: first?.usd };
    if (was.slug !== slug) {
      setStatus(null);
      if (first) setAmount(String(first.usd));
      return;
    }
    if (first && was.usd === undefined) {
      setAmount((cur) => (cur === "" ? String(first.usd) : cur));
    }
  }, [first?.usd, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const onAmountRef = useRef(onAmount);
  onAmountRef.current = onAmount;
  useEffect(() => onAmountRef.current?.(parseUsd(amount)), [amount]);

  const suggestedAt = new Map(suggested.map((x) => [String(x.usd), x]));
  const chips = donateChips([...suggestedAt.keys()], cap?.usd);
  const chipAt = (c: string) =>
    suggestedAt.get(c) ?? (cap && c === String(cap.usd) ? cap : undefined);
  const labelled = chips.some((c) => chipAt(c)?.label);
  const usd = parseUsd(amount);
  // More than it needs: not sent.
  const over = Boolean(cap && usd > cap.usd);

  const donate = async () => {
    if (!target) return setStatus({ kind: "err", text: "This round takes no test donations." });
    if (!(usd > 0)) return setStatus({ kind: "err", text: "Enter an amount in dollars." });
    if (usd > TEST_USD_MAX_MINT) {
      return setStatus({ kind: "err", text: "A million test dollars at most, at a time." });
    }
    if (!wallet.config || !wallet.address) {
      return setStatus({ kind: "err", text: "Connect your wallet first." });
    }
    const me = wallet.address as Hex;
    try {
      setStatus(null);
      setBusy("Switching to Sepolia…");
      await ensureChain();
      // Gas: a wallet with no Sepolia ETH asks once, with its badge.
      if (badge !== undefined && (await voteClient().getBalance({ address: me })) === 0n) {
        setBusy("Getting gas…");
        const { hash } = await api<{ hash: Hex | null }>("/api/vote/gas", {
          method: "POST",
          json: { tokenId: String(badge) },
        });
        if (hash) await voteClient().waitForTransactionReceipt({ hash, timeout: WAIT_MS });
      }
      setBusy("Confirm in your wallet…");
      const hash = await writeContract(wallet.config, {
        address: target.token,
        abi: TEST_USD_ABI,
        functionName: "mint",
        args: [target.account, BigInt(Math.round(usd * 1e6))],
        chainId: ROUND.chainId,
        account: me,
        connector: liveConnector(wallet),
      } as never);
      setBusy("Waiting for Sepolia…");
      const r = await voteClient().waitForTransactionReceipt({ hash, timeout: WAIT_MS });
      if (r.status !== "success") throw new Error("The donation failed on-chain. Try again.");
      setStatus({
        kind: "ok",
        text: `$${
          usd.toLocaleString("en-US")
        } in test dollars is on its account. It counts from the next tally.`,
      });
      onDonated?.();
    } catch (e) {
      setStatus({ kind: "err", text: walletErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-4 gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={chipAt(c)
              ? `$${Number(c).toLocaleString("en-US")}, ${chipAt(c)!.note}`
              : undefined}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-full border px-1 py-2 text-center font-inter-tight text-[13px] transition-all duration-150 max-[760px]:py-[11px]",
              labelled && "rounded-xl py-1.5 max-[760px]:py-2",
              amount === c
                ? red
                  ? "border-dao-red bg-dao-red font-medium text-white"
                  : "border-dao-green bg-dao-green font-medium text-white"
                : red
                ? "border-edge2 bg-white/5 text-soft hover:border-dao-red/60 hover:text-[#ff8a88]"
                : "border-edge2 bg-white/5 text-soft hover:border-[rgba(92,183,90,.6)] hover:text-dao-green",
            )}
            onClick={() => setAmount(c)}
          >
            ${Number(c).toLocaleString("en-US")}
            {chipAt(c)?.label && (
              <small className="block text-[11px] font-normal leading-tight opacity-80">
                {chipAt(c)!.label}
              </small>
            )}
          </button>
        ))}
      </div>
      <label
        className={cn(
          "flex min-w-0 items-center gap-0.5 rounded-xl border border-edge2 bg-card pl-3.5",
          red ? "focus-within:border-dao-red/60" : "focus-within:border-[rgba(92,183,90,.6)]",
        )}
      >
        <span className="flex-none font-inter-tight text-[14px] font-light text-muted">$</span>
        <input
          className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 pr-3.5 font-inter-tight text-[14px] font-light text-white outline-none placeholder:text-white/35"
          inputMode="decimal"
          placeholder="Custom amount"
          aria-label="Amount in US dollars"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="flex-none pr-3.5 font-inter-tight text-[13px] text-muted">tUSD</span>
      </label>
      {over && <OverCap cap={cap!.usd} />}
      <p className="m-0 small dim">
        A test vote: this sends test dollars (tUSD) on Sepolia straight to the initiative's account.
        No real money moves.
      </p>
      <Button variant="primary" onClick={donate} disabled={Boolean(busy) || !target || over}>
        {busy ?? "Donate test dollars"}
      </Button>
      {status && <Status kind={status.kind}>{status.text}</Status>}
    </div>
  );
}
