/**
 * Wallet donation flow (port of static/app.js initWidget/donate/confirmTx):
 * USD amount -> token quantity -> wallet tx -> API confirm + status polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getBalance, readContract, sendTransaction, switchChain } from "wagmi/actions";
import { erc20Abi } from "viem";
import { useAccount, useConfig, useConnect } from "wagmi";
import { api, ApiError, errorMessage, isMaintenance } from "~/lib/api";
import type { AcceptanceReceipt, ExchangeDetails, WalletIntent } from "../../../shared/terms.ts";
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
  initiativeId: string;
  slug: string;
  safeAddress: string;
  params: DonateParams | undefined;
  onConfirmed?: (r: DonateResult) => void;
  /** Current explicit checkbox state; never restored from a local timestamp. */
  accepted?: boolean;
}

const POLL_MS = 6000;
// Confirm submissions share an IP quota of 30 / 10 min; leave room for retries.
const ATTEMPT_POLL_MS = 30_000;
const MAX_POLLS = 50;
/** A confirm that fails on the network is retried this many times before polling takes over. */
const CONFIRM_RETRIES = 2;
/** Shown instead of retrying while an admin has paused the site. */
const MAINTENANCE_TEXT =
  "The site is in maintenance. Your transfer is on-chain and will be credited once maintenance ends; keep the transaction link.";
const CONFIRM_RETRY_MS = 1500;
const PENDING: DonateResult = { status: "pending", detail: "", amount: 0, token: "", amountUsd: 0 };

export function useDonation(
  { initiativeId, slug, safeAddress, params, onConfirmed, accepted }: UseDonationArgs,
) {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  // Read at confirm time through refs so confirmTx keeps a stable identity.
  const acceptedRef = useRef(false);
  acceptedRef.current = accepted ?? false;
  const sending = useRef(false);
  const { connectors, connectAsync } = useConnect();
  const [status, setStatus] = useState<DonationStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Keep the attempt through retries until the server has persisted the transaction hash.
  const confirmations = useRef(
    new Map<string, {
      initiativeId: string;
      slug: string;
      txHash: string;
      attemptId: string;
    }>(),
  );
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const handle = useCallback((txHash: string, res: DonateResult, attempt: number) => {
    if (res.status === "confirmed") {
      confirmations.current.delete(txHash);
      try {
        sessionStorage.removeItem("thedao:donation:" + initiativeId);
      } catch { /* unavailable */ }
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
        text: confirmations.current.has(txHash)
          ? (
            <>
              Still pending. Your transfer will be credited automatically. Keep this page open to
              finish submitting your transaction reference.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setBusy("Confirming…");
                  handle(txHash, PENDING, 0);
                }}
              >
                Retry confirmation
              </button>
            </>
          )
          : "Still pending. It will be credited automatically once it confirms. You can close this page.",
      });
      return;
    }
    pollTimer.current = globalThis.setTimeout(() => {
      const confirmation = confirmations.current.get(txHash);
      const request = confirmation
        ? api<DonateResult>("/api/donate/confirm", { json: confirmation, passive: true })
        : api<DonateResult>(`/api/donate/status/${txHash}`, { passive: true });
      request
        .then((r) => handle(txHash, r, attempt + 1))
        .catch((error) => {
          if (isMaintenance(error)) {
            setBusy(null);
            setStatus({ kind: "wait", text: MAINTENANCE_TEXT });
            return;
          }
          if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
            setBusy(null);
            setStatus({ kind: "err", text: errorMessage(error) });
            return;
          }
          handle(txHash, PENDING, attempt + 1);
        });
    }, confirmations.current.has(txHash) ? ATTEMPT_POLL_MS : POLL_MS);
  }, [params, onConfirmed, initiativeId]);

  const recordAcceptance = useCallback(async (
    method: "wallet" | "exchange",
    details?: ExchangeDetails,
    wallet?: Omit<WalletIntent, "afterBlock">,
  ) => {
    if (!acceptedRef.current) throw new Error("Please agree to the donation terms first.");
    return await api<AcceptanceReceipt>("/api/donate/accept", {
      json: {
        initiativeId,
        slug,
        recipient: safeAddress,
        chainId: 1,
        version: TERMS.id,
        agreed: true,
        method,
        ...(details ? { details } : {}),
        ...(wallet ? { wallet } : {}),
      },
    });
  }, [initiativeId, slug, safeAddress]);

  /** A public hash is accounting data, never evidence of wallet ownership. */
  const confirmTx = useCallback(async (txHash: string, attemptId?: string) => {
    stopPolling();
    setBusy("Confirming…");
    const json = attemptId ? { initiativeId, slug, txHash, attemptId } : undefined;
    if (json) {
      confirmations.current.set(txHash, json);
      // Only public references; the session credential stays in an HttpOnly cookie.
      try {
        sessionStorage.setItem("thedao:donation:" + initiativeId, JSON.stringify(json));
      } catch { /* unavailable */ }
    }
    const request = json ?? { initiativeId, slug, txHash };
    for (let attempt = 0;; attempt++) {
      try {
        handle(txHash, await api<DonateResult>("/api/donate/confirm", { json: request }), 0);
        return;
      } catch (e) {
        if (isMaintenance(e)) {
          // The hash stays stored, so the next visit confirms it.
          setBusy(null);
          setStatus({ kind: "wait", text: MAINTENANCE_TEXT });
          return;
        }
        if (e instanceof ApiError && e.status < 500 && e.status !== 429) {
          setBusy(null);
          setStatus({ kind: "err", text: errorMessage(e) });
          return;
        }
        if (attempt < CONFIRM_RETRIES) {
          await new Promise((r) => setTimeout(r, CONFIRM_RETRY_MS * (attempt + 1)));
          continue;
        }
        // Keep retrying submission until the server has the attempt and hash.
        handle(txHash, PENDING, 0);
        return;
      }
    }
  }, [initiativeId, slug, handle]);

  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (restored.current === initiativeId) return;
    restored.current = initiativeId;
    try {
      const raw = sessionStorage.getItem("thedao:donation:" + initiativeId);
      const saved = raw ? JSON.parse(raw) : null;
      if (
        saved?.initiativeId === initiativeId && saved.slug === slug &&
        /^0x[0-9a-f]{64}$/.test(saved.txHash) && /^[A-Za-z0-9_-]{43}$/.test(saved.attemptId)
      ) {
        void confirmTx(saved.txHash, saved.attemptId);
      }
    } catch { /* unavailable or stale browser data */ }
  }, [initiativeId, slug, confirmTx]);
  useEffect(() => () => stopPolling(), []);

  const donate = useCallback(
    /** Resolves to whether the agreement was used up: a refusal before it is
     * recorded (bad amount, empty wallet) leaves the terms tick in place. */
    async (
      symbol: string,
      usdRaw: string,
      balances: Record<string, number | null>,
    ): Promise<boolean> => {
      let agreementUsed = false;
      if (busy || sending.current) return false;
      if (!acceptedRef.current) {
        setStatus({ kind: "err", text: "Please agree to the donation terms first." });
        return false;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(safeAddress)) {
        setStatus({ kind: "err", text: "This initiative's donation address is not set up yet." });
        return false;
      }
      if (!params?.enabled) {
        setStatus({ kind: "err", text: "Donations are unavailable right now." });
        return false;
      }
      const tok = params.tokens[symbol];
      if (!tok) {
        setStatus({
          kind: "err",
          text: "That token isn't available to donate right now. Pick another from the list.",
        });
        return false;
      }
      const rate = params.rates[symbol] || 1;
      const usd = parseUsd(usdRaw);
      if (!(usd > 0)) {
        setStatus({ kind: "err", text: "Enter the amount in dollars, like 100 or 49.50." });
        return false;
      }
      const qtyStr = tokenQty(usd, rate, tok.decimals);
      const base = toBaseUnits(qtyStr, tok.decimals);
      if (base === null) {
        setStatus({ kind: "err", text: `That amount is too small for ${symbol}.` });
        return false;
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
          return false;
        }
      } else if (qtyNum < (params.minTokenUnits || 1)) {
        setStatus({
          kind: "err",
          text: `The minimum donation is 1 ${symbol} (about $${
            rate.toFixed(2)
          }). Enter a larger amount.`,
        });
        return false;
      }
      sending.current = true;
      try {
        let account = address;
        if (!isConnected || !account) {
          const usable = connectors.filter((c) => c.id !== "mock");
          if (!usable.length) {
            setStatus({
              kind: "err",
              text: "No wallet detected in this browser. Use the exchange option instead.",
            });
            return false;
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
              }). Top it up, switch wallets (button top right), or use the exchange option.`,
          });
          return false;
        }
        if (typeof bal === "number" && bal < qtyNum) {
          setStatus({
            kind: "err",
            text: `Not enough ${symbol}: you hold ${
              bal.toFixed(4)
            }, this donation needs ${qtyStr}.`,
          });
          return false;
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
        setBusy("Recording agreement…");
        agreementUsed = true;
        const acceptance = await recordAcceptance("wallet", undefined, {
          address: account!,
          token: tok.address,
          amountRaw: base.toString(),
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
                href={`https://eth.blockscout.com/tx/${txHash}`}
              >
                {shortAddr(txHash)}
              </a>
            </>
          ),
        });
        await confirmTx(txHash.toLowerCase(), acceptance.attemptId);
      } catch (e) {
        setBusy(null);
        const noWallet = /provider not found/i.test(String((e as Error)?.message));
        setStatus({
          kind: "err",
          text: noWallet
            ? "No wallet detected in this browser. Use the exchange option instead."
            : "Not sent: " + walletErrorMessage(e),
        });
      } finally {
        sending.current = false;
      }
      return agreementUsed;
    },
    [
      busy,
      safeAddress,
      params,
      address,
      isConnected,
      connectors,
      connectAsync,
      config,
      confirmTx,
      recordAcceptance,
    ],
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

  return {
    status,
    setStatus,
    busy,
    donate,
    confirmTx,
    recordAcceptance,
    loadBalances,
    address,
    isConnected,
  };
}
