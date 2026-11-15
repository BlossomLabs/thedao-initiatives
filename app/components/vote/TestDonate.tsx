import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { writeContract } from "wagmi/actions";
import { useWallet } from "~/context/wallet";
import { api } from "~/lib/api";
import { parseUsd, walletErrorMessage } from "~/lib/donate";
import { liveConnector } from "~/lib/wallet-store";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import type { Suggestion } from "~/components/donate/DonateWidget";
import { useEnsureVoteChain } from "~/hooks/use-vote-chain";
import { voteClient } from "~/hooks/use-vote-send";
import { ROUND } from "../../../shared/vote/manifest";
import { TEST_USD_ABI, TEST_USD_MAX_MINT, testDonation } from "../../../shared/vote/test-usd";

const CHIPS = ["50", "500", "5000", "50000"];
const WAIT_MS = 3 * 60_000;

/**
 * A test round's donate form: test dollars (tUSD, Sepolia) minted straight to the
 * initiative's account, which the round counts at $1 from the next tally on. No real
 * money moves, and nothing is needed but a little Sepolia ETH for gas (a badge's one
 * gas top-up when the wallet has none).
 */
export default function TestDonate(
  { slug, suggested = [], onAmount, onDonated, badge, accent = "green" }: {
    slug: string;
    suggested?: Suggestion[];
    onAmount?: (usd: number) => void;
    onDonated?: () => void;
    /** The voter's badge, for the gas top-up. */
    badge?: number;
    accent?: "green" | "red";
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
  // Another initiative: start from its suggestion. A new suggestion for the same one (the
  // round changed on-chain) replaces the amount only if it was the last suggestion.
  const suggestedFor = useRef({ slug, usd: first?.usd });
  useEffect(() => {
    const was = suggestedFor.current;
    suggestedFor.current = { slug, usd: first?.usd };
    if (was.slug !== slug) {
      setStatus(null);
      if (first) setAmount(String(first.usd));
      return;
    }
    if (!first) return;
    setAmount((
      cur,
    ) => (was.usd === undefined || cur === String(was.usd) ? String(first.usd) : cur));
  }, [first?.usd, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const onAmountRef = useRef(onAmount);
  onAmountRef.current = onAmount;
  useEffect(() => onAmountRef.current?.(parseUsd(amount)), [amount]);

  const suggestedAt = new Map(suggested.map((x) => [String(x.usd), x]));
  const chips = suggested.length
    ? [...suggestedAt.keys(), ...CHIPS.slice(1).filter((c) => !suggestedAt.has(c))]
      .slice(0, CHIPS.length)
      .sort((a, b) => Number(a) - Number(b))
    : CHIPS;
  const usd = parseUsd(amount);

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
            aria-label={suggestedAt.has(c)
              ? `$${Number(c).toLocaleString("en-US")}, ${suggestedAt.get(c)!.note}`
              : undefined}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-full border px-1 py-2 text-center font-inter-tight text-[13px] transition-all duration-150 max-[760px]:py-[11px]",
              suggested.some((x) => x.label) && "rounded-xl py-1.5 max-[760px]:py-2",
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
            {suggestedAt.get(c)?.label && (
              <small className="block text-[11px] font-normal leading-tight opacity-80">
                {suggestedAt.get(c)!.label}
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
      <p className="m-0 small dim">
        A test vote: this sends test dollars (tUSD) on Sepolia straight to the initiative's account.
        No real money moves.
      </p>
      <Button variant="primary" onClick={donate} disabled={Boolean(busy) || !target}>
        {busy ?? "Donate test dollars"}
      </Button>
      {status && <Status kind={status.kind}>{status.text}</Status>}
    </div>
  );
}
