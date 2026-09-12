/**
 * Wallet donation flow (port of static/app.js initWidget/donate/confirmTx):
 * USD amount -> token quantity -> wallet tx -> API confirm + status polling.
 */
import { useCallback, useRef, useState } from "react";
import { getBalance, readContract, sendTransaction, switchChain } from "wagmi/actions";
import { erc20Abi } from "viem";
import { useAccount, useConfig, useConnect } from "wagmi";
import { api, ApiError, errorMessage } from "~/lib/api";
import { TERMS } from "~/data/terms";
import type { DonateParams, DonateResult } from "~/lib/api-types";
import {
  parseUsd,
  toBaseUnits,
  tokenQty,
  transferCalldata,
  walletErrorMessage,
} from "~/lib/donate";
import { shortAddr } from "~/lib/format";
import { confettiBurst } from "./Celebration";

export interface DonationStatus {
  kind: "ok" | "err" | "wait";
  text: React.ReactNode;
}

export interface UseDonationArgs {
  slug: string;
  safeAddress: string;
  params: DonateParams | undefined;
  onConfirmed?: (r: DonateResult) => void;
  /** ISO timestamp of the donor's terms checkbox tick, or null while unticked. */
  acceptedAt?: string | null;
}

const POLL_MS = 6000;
const MAX_POLLS = 50;
/** A confirm that fails on the network is retried this many times before polling takes over. */
const CONFIRM_RETRIES = 2;
const CONFIRM_RETRY_MS = 1500;
const PENDING: DonateResult = { status: "pending", detail: "", amount: 0, token: "", amountUsd: 0 };

export function useDonation(
  { slug, safeAddress, params, onConfirmed, acceptedAt }: UseDonationArgs,
) {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  // Read at confirm time through refs so confirmTx keeps a stable identity.
  const acceptedRef = useRef<string | null>(null);
  acceptedRef.current = acceptedAt ?? null;
  const addressRef = useRef(address);
  addressRef.current = address;
  const { connectors, connectAsync } = useConnect();
  const [status, setStatus] = useState<DonationStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const handle = useCallback((txHash: string, res: DonateResult, attempt: number) => {
    if (res.status === "confirmed") {
      setBusy(null);
      const rate = params?.enabled ? params.rates[res.token] : undefined;
      const dollars = "$" + Number(res.amountUsd).toFixed(2);
      const amt = res.amountUsd
        ? rate && rate !== 1
          ? `${dollars} (${res.amount} ${res.token})`
          : `${dollars} in ${res.token}`
        : `${res.amount} ${res.token}`;
      setStatus({
        kind: "ok",
        text: (
          <>
            🦸 <b>{amt}</b> is now backing this initiative. You're a hero.
          </>
        ),
      });
      confettiBurst();
      onConfirmed?.(res);
      return;
    }
    if (res.status === "failed" || res.status === "error") {
      setBusy(null);
      setStatus({ kind: "err", text: `Verification failed: ${res.detail || "unknown reason"}` });
      return;
    }
    if (attempt > MAX_POLLS) {
      setBusy(null);
      setStatus({
        kind: "wait",
        text:
          "Still pending. It will be credited automatically once it confirms. You can close this page.",
      });
      return;
    }
    pollTimer.current = globalThis.setTimeout(() => {
      api<DonateResult>(`/api/donate/status/${txHash}`, { token: null })
        .then((r) => handle(txHash, r, attempt + 1))
        .catch(() =>
          handle(
            txHash,
            { status: "pending", detail: "", amount: 0, token: "", amountUsd: 0 },
            attempt + 1,
          )
        );
    }, POLL_MS);
  }, [params, onConfirmed]);

  /**
   * Verify a tx hash with the API (used after sending and for manual paste).
   * The confirm also carries the donor's terms acceptance, which the API binds
   * to this tx, so a network blip is retried before polling takes over.
   */
  const confirmTx = useCallback(async (txHash: string) => {
    stopPolling();
    setBusy("Confirming…");
    const acceptedAt = acceptedRef.current;
    const terms = acceptedAt
      ? {
        version: TERMS.id,
        acceptedAt,
        ...(addressRef.current ? { address: addressRef.current } : {}),
      }
      : undefined;
    const json = { slug, txHash, ...(terms ? { terms } : {}) };
    for (let attempt = 0;; attempt++) {
      try {
        handle(txHash, await api<DonateResult>("/api/donate/confirm", { json, token: null }), 0);
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status < 500) {
          setBusy(null);
          setStatus({ kind: "err", text: errorMessage(e) });
          return;
        }
        if (attempt < CONFIRM_RETRIES) {
          await new Promise((r) => setTimeout(r, CONFIRM_RETRY_MS * (attempt + 1)));
          continue;
        }
        // Still failing: fall back to polling the status endpoint.
        handle(txHash, PENDING, 0);
        return;
      }
    }
  }, [slug, handle]);

  const donate = useCallback(
    async (symbol: string, usdRaw: string, balances: Record<string, number | null>) => {
      if (busy) return;
      if (!/^0x[0-9a-fA-F]{40}$/.test(safeAddress)) {
        setStatus({ kind: "err", text: "This initiative's donation address is not set up yet." });
        return;
      }
      if (!params?.enabled) {
        setStatus({ kind: "err", text: "Donations are unavailable right now." });
        return;
      }
      const tok = params.tokens[symbol];
      if (!tok) {
        setStatus({
          kind: "err",
          text: "That token isn't available to donate right now. Pick another from the list.",
        });
        return;
      }
      const rate = params.rates[symbol] || 1;
      const usd = parseUsd(usdRaw);
      if (!(usd > 0)) {
        setStatus({ kind: "err", text: "Enter the amount in dollars, like 100 or 49.50." });
        return;
      }
      const qtyStr = tokenQty(usd, rate, tok.decimals);
      const base = toBaseUnits(qtyStr, tok.decimals);
      if (base === null) {
        setStatus({ kind: "err", text: `That amount is too small for ${symbol}.` });
        return;
      }
      const isNative = tok.address === "native";
      const qtyNum = parseFloat(qtyStr);
      if (isNative) {
        if (qtyNum < params.minEth) {
          setStatus({
            kind: "err",
            text: `That is below the minimum ETH donation (${params.minEth} ETH, about $${
              (params.minEth * rate).toFixed(2)
            }). Enter a larger amount.`,
          });
          return;
        }
      } else if (qtyNum < (params.minTokenUnits || 1)) {
        setStatus({
          kind: "err",
          text: `The minimum donation is 1 ${symbol} (about $${
            rate.toFixed(2)
          }). Enter a larger amount.`,
        });
        return;
      }
      try {
        let account = address;
        if (!isConnected || !account) {
          const usable = connectors.filter((c) => c.id !== "mock");
          if (!usable.length) {
            setStatus({
              kind: "err",
              text: "No wallet detected in this browser. Use the card or exchange options instead.",
            });
            return;
          }
          setStatus({ kind: "wait", text: "Connecting wallet…" });
          const r = await connectAsync({ connector: usable[0], chainId: 1 });
          account = r.accounts[0];
        }
        const bal = balances[symbol];
        if (typeof bal === "number" && bal <= 0) {
          const held = Object.keys(params.tokens).filter((s) => (balances[s] ?? 0) > 0);
          setStatus({
            kind: "err",
            text: held.length
              ? `This wallet holds no ${symbol}. You do hold: ${held.join(", ")}.`
              : `This wallet holds none of the accepted tokens (${
                Object.keys(params.tokens).join(", ")
              }). Top it up, switch wallets (button top right), or use the card or exchange options.`,
          });
          return;
        }
        if (typeof bal === "number" && bal < qtyNum) {
          setStatus({
            kind: "err",
            text: `Not enough ${symbol}: you hold ${
              bal.toFixed(4)
            }, this donation needs ${qtyStr}.`,
          });
          return;
        }
        setStatus({
          kind: "wait",
          text: (
            <>
              Check your wallet to approve:<br />
              <b>{qtyStr} {symbol}</b>
              {rate !== 1 && <>(about ${usd})</>} → <b>this initiative's Safe</b>{" "}
              <span className="mono dim">({shortAddr(safeAddress)})</span>
            </>
          ),
        });
        setBusy("Confirm in wallet…");
        await switchChain(config, { chainId: 1 }).catch(() => {});
        const txHash = isNative
          ? await sendTransaction(config, {
            account: account as `0x${string}`,
            to: safeAddress as `0x${string}`,
            value: base,
            chainId: 1,
          })
          : await sendTransaction(config, {
            account: account as `0x${string}`,
            to: tok.address as `0x${string}`,
            data: transferCalldata(safeAddress, base),
            value: 0n,
            chainId: 1,
          });
        setStatus({
          kind: "wait",
          text: (
            <>
              Sent. Waiting for mainnet confirmation…<br />
              <a
                className="mono"
                target="_blank"
                rel="noopener"
                href={`https://etherscan.io/tx/${txHash}`}
              >
                {shortAddr(txHash)}
              </a>
            </>
          ),
        });
        await confirmTx(txHash.toLowerCase());
      } catch (e) {
        setBusy(null);
        setStatus({ kind: "err", text: "Not sent: " + walletErrorMessage(e) });
      }
    },
    [busy, safeAddress, params, address, isConnected, connectors, connectAsync, config, confirmTx],
  );

  /** Token balances of the connected wallet (null = unknown yet). */
  const loadBalances = useCallback(async (): Promise<Record<string, number | null>> => {
    const out: Record<string, number | null> = {};
    if (!address || !params?.enabled) return out;
    await Promise.all(
      Object.entries(params.tokens).map(async ([sym, t]) => {
        try {
          const raw = t.address === "native"
            ? (await getBalance(config, { address, chainId: 1 })).value
            : await readContract(config, {
              address: t.address as `0x${string}`,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
              chainId: 1,
            });
          out[sym] = Number(raw) / 10 ** t.decimals;
        } catch {
          out[sym] = null;
        }
      }),
    );
    return out;
  }, [address, params, config]);

  return { status, setStatus, busy, donate, confirmTx, loadBalances, address, isConnected };
}
