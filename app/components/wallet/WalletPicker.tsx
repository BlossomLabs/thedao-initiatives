import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Copy, Mail, QrCode, Search, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Connector } from "wagmi";
import { Dialog } from "~/components/ui/Dialog";
import { useSession } from "~/context/session";
import { useEmailSignIn } from "~/context/email-sign-in";
import { useConnectors } from "~/hooks/use-connectors";
import { walletErrorMessage } from "~/lib/donate";
import { PRIVY_CONNECTOR_ID } from "~/lib/privy";
import {
  metaMaskBrowserLink,
  type MobileWallet,
  normalizeWallets,
  walletDeepLink,
} from "~/lib/mobile-wallets";
import { cn } from "~/lib/utils";

const row =
  "flex w-full items-center gap-3 rounded-xl border border-edge2 bg-white/[.025] px-3.5 py-3 text-left text-sm text-soft transition-colors hover:border-dao-green/50 hover:bg-white/[.06] hover:text-white focus-visible:outline-2 focus-visible:outline-dao-green disabled:cursor-default disabled:opacity-50";
const smallButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-edge2 px-3 py-2 text-[13px] text-soft hover:bg-white/5 disabled:opacity-50";

export default function WalletPicker({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connectors = useConnectors();
  const { connect, connecting, signingIn } = useSession();
  const { openEmailSignIn } = useEmailSignIn();
  const [view, setView] = useState<"choose" | "mobile">("choose");
  const [tab, setTab] = useState<"wallets" | "qr">("wallets");
  const [wallets, setWallets] = useState<MobileWallet[] | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [uri, setUri] = useState<string | null>(null);
  const [selected, setSelected] = useState<MobileWallet | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [injectedAvailable, setInjectedAvailable] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  const detach = useRef<(() => void) | null>(null);
  const wc = connectors.find((c) => c.id === "walletConnect");

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      detach.current?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const injected = connectors.find((c) => c.id === "injected");
    setInjectedAvailable(false);
    void injected?.getProvider().then((provider) => {
      if (live) setInjectedAvailable(Boolean(provider));
    }).catch(() => {});
    if (!running.current) {
      setView("choose");
      setError("");
    }
    return () => {
      live = false;
    };
  }, [open, connectors]);

  useEffect(() => {
    if (view !== "mobile" || wallets) return;
    const controller = new AbortController();
    setDirectoryError("");
    void fetch("/wallets.json", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Directory unavailable");
      const data = await response.json();
      const entries = normalizeWallets(data.wallets);
      if (!entries.length) throw new Error("Empty directory");
      if (!controller.signal.aborted) setWallets(entries);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setDirectoryError(
          "The wallet list could not load. You can still scan the QR code or copy the connection URI.",
        );
      }
    });
    return () => controller.abort();
  }, [view, wallets, reload]);

  async function start(connector: Connector) {
    if (running.current || connecting || signingIn) return;
    running.current = true;
    setPending(true);
    setPairing(connector.id === "walletConnect");
    setError("");
    setUri(null);
    setSelected(null);
    setCopied(false);
    if (connector.id === "walletConnect") {
      const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
        if (alive.current && type === "display_uri" && typeof data === "string") {
          setUri(data);
          setCopied(false);
        }
      };
      connector.emitter.on("message", onMessage);
      detach.current = () => connector.emitter.off("message", onMessage);
    }
    try {
      // Includes SIWE. Keep the chooser available until the signature completes.
      await connect(connector);
      if (alive.current) {
        onOpenChange(false);
        setView("choose");
      }
    } catch (e) {
      if (alive.current) setError("Not connected: " + walletErrorMessage(e));
    } finally {
      detach.current?.();
      detach.current = null;
      running.current = false;
      if (alive.current) {
        setPending(false);
        setUri(null);
        setSelected(null);
      }
    }
  }

  function mobile() {
    setView("mobile");
    if (wc && !running.current) void start(wc);
  }

  async function copy() {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch {
      setError("Could not copy. Use the QR code or select and copy the URI below.");
    }
  }

  const busy = pending || connecting || signingIn;
  const visible = (wallets ?? []).filter((w) =>
    w.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const selectedLink = selected
    ? walletDeepLink(selected, signingIn ? undefined : uri ?? undefined)
    : null;
  const browserLink = typeof location === "undefined" ? undefined : metaMaskBrowserLink(location);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={view === "choose" ? "Connect wallet" : "Connect your mobile wallet"}
      description={view === "choose"
        ? "Use a wallet in this browser, or connect from a wallet app."
        : "Choose your wallet app, or scan the QR code from another device."}
      className="max-h-[calc(100dvh-40px)] overflow-y-auto sm:w-[460px]"
    >
      {view === "choose"
        ? (
          <div className="flex flex-col gap-2">
            {connectors.filter((c) =>
              c.id !== "walletConnect" && (c.id !== "injected" || injectedAvailable)
            ).map((c) => (
              <button
                key={c.uid}
                type="button"
                className={row}
                disabled={busy}
                onClick={() => {
                  if (c.id === PRIVY_CONNECTOR_ID) {
                    onOpenChange(false);
                    openEmailSignIn();
                  } else void start(c);
                }}
              >
                {c.icon
                  ? <img src={c.icon} alt="" className="size-7 rounded-lg" />
                  : c.id === PRIVY_CONNECTOR_ID
                  ? <Mail className="size-5" />
                  : <Wallet className="size-5" />}
                <span className="flex-1">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                <ArrowUpRight className="size-4 text-muted" />
              </button>
            ))}
            <button
              type="button"
              className={row}
              onClick={mobile}
              disabled={busy && !(pending && pairing)}
            >
              <QrCode className="size-5 text-dao-green" />
              <span className="flex-1">
                <span className="block">
                  {pending && pairing ? "Continue wallet connection" : "Mobile wallets / QR code"}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Choose from the WalletConnect directory
                </span>
              </span>
              <ArrowUpRight className="size-4 text-muted" />
            </button>
          </div>
        )
        : (
          <>
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-xs text-muted hover:text-white"
              onClick={() => setView("choose")}
            >
              <ArrowLeft className="size-3.5" /> All connection methods
            </button>
            {!wc && (
              <p role="status" className="text-sm text-muted">
                Mobile pairing is unavailable on this site. You can open the site in your wallet’s
                browser, including MetaMask below.
              </p>
            )}
            {wc && (
              <>
                <div
                  role="status"
                  className="rounded-xl border border-dao-green/25 bg-dao-green/5 px-3 py-2.5 text-[13px] text-soft"
                >
                  {signingIn
                    ? "Approve the sign-in message in your wallet, then return here."
                    : uri
                    ? selected
                      ? `Approve in ${selected.name}, then return here.`
                      : tab === "qr"
                      ? "Scan with your wallet, or copy the connection URI."
                      : "Connection ready. Choose a wallet below."
                    : pending
                    ? "Preparing your connection…"
                    : "Start a new connection to try again."}
                  {selectedLink && (
                    <a
                      className="mt-2 flex w-fit items-center gap-1 font-medium text-dao-green underline underline-offset-4"
                      href={selectedLink}
                    >
                      Open {selected?.name}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  )}
                  {!busy && (
                    <button
                      type="button"
                      className={cn(smallButton, "mt-2")}
                      onClick={() => void start(wc)}
                    >
                      Try again
                    </button>
                  )}
                </div>
                <div
                  className="flex rounded-lg bg-black/15 p-1"
                  role="group"
                  aria-label="Connection method"
                >
                  {(["wallets", "qr"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={tab === value}
                      className={cn(
                        "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                        tab === value ? "bg-white/10 text-white" : "text-muted hover:text-white",
                      )}
                      onClick={() => setTab(value)}
                    >
                      {value === "wallets" ? "Wallet apps" : "QR code / copy"}
                    </button>
                  ))}
                </div>
                {tab === "wallets"
                  ? (
                    <>
                      <label className="flex items-center gap-2 rounded-lg border border-edge2 px-3 py-2.5">
                        <Search className="size-4 text-muted" />
                        <input
                          aria-label="Search mobile wallets"
                          type="search"
                          placeholder="Search wallets…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                        />
                      </label>
                      <div
                        className="max-h-[min(32dvh,260px)] overflow-y-auto"
                        aria-label="Mobile wallets"
                      >
                        {visible.map((w) => {
                          const href = uri && !signingIn ? walletDeepLink(w, uri) : null;
                          const content = (
                            <>
                              <span
                                aria-hidden="true"
                                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge2 bg-white/5 text-xs font-medium text-dao-rfp"
                              >
                                {w.name.slice(0, 2).toUpperCase()}
                              </span>
                              <span className="min-w-0 flex-1">{w.name}</span>
                              {walletDeepLink(w)
                                ? <ArrowUpRight className="size-4 shrink-0 text-muted" />
                                : <QrCode className="size-4 shrink-0 text-muted" />}
                            </>
                          );
                          return href
                            ? (
                              <a
                                key={w.id}
                                href={href}
                                className={cn(row, "border-transparent")}
                                onClick={() => setSelected(w)}
                              >
                                {content}
                              </a>
                            )
                            : (
                              <button
                                key={w.id}
                                type="button"
                                className={cn(row, "border-transparent")}
                                disabled={!uri || signingIn}
                                onClick={() => setTab("qr")}
                              >
                                {content}
                              </button>
                            );
                        })}
                        {!wallets && !directoryError && (
                          <p className="py-4 text-sm text-muted" role="status">
                            Loading wallet directory…
                          </p>
                        )}
                        {wallets && !visible.length && (
                          <p className="py-4 text-sm text-muted">
                            No matching wallet. Use QR code / copy to connect another compatible
                            wallet.
                          </p>
                        )}
                      </div>
                      {directoryError && (
                        <div role="alert" className="text-xs text-muted">
                          {directoryError}
                          <button
                            type="button"
                            className="ml-1 underline"
                            onClick={() => setReload((v) => v + 1)}
                          >
                            Reload list
                          </button>
                        </div>
                      )}
                    </>
                  )
                  : (
                    <div className="flex flex-col items-center gap-3">
                      {uri && !signingIn
                        ? (
                          <div className="rounded-xl bg-white p-4">
                            <QRCodeSVG
                              value={uri}
                              size={200}
                              title="WalletConnect pairing QR code"
                            />
                          </div>
                        )
                        : (
                          <p className="py-8 text-sm text-muted">
                            {signingIn
                              ? "Connection approved. Complete the sign-in in your wallet."
                              : "The QR code appears when your connection is ready."}
                          </p>
                        )}
                      <button
                        type="button"
                        className={smallButton}
                        disabled={!uri || signingIn}
                        onClick={() => void copy()}
                      >
                        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                        {copied ? "Copied" : "Copy connection URI"}
                      </button>
                      {uri && !signingIn && (
                        <input
                          aria-label="WalletConnect connection URI"
                          readOnly
                          value={uri}
                          onFocus={(e) => e.currentTarget.select()}
                          className="w-full rounded-md border border-edge2 bg-black/10 p-2 font-mono text-[10px] text-muted"
                        />
                      )}
                    </div>
                  )}
              </>
            )}
          </>
        )}
      {error && <p role="alert" className="m-0 text-[12.5px] text-[#ffd7d6]">{error}</p>}
      {busy && (
        <p className="m-0 text-xs text-muted">
          {view === "choose" ? "Check your wallet to finish the pending request. " : ""}Closing this
          window keeps the request open. Use Connect wallet to return.
        </p>
      )}
      <div className="mt-1 border-t border-edge2 pt-3">
        <a
          href={browserLink}
          className="inline-flex items-center gap-1 text-xs text-muted underline underline-offset-4 hover:text-white"
        >
          Open in MetaMask browser<ArrowUpRight className="size-3" />
        </a>
      </div>
    </Dialog>
  );
}
