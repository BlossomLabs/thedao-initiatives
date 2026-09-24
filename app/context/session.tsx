/**
 * SIWE session: one signature per session. The token itself lives in an
 * HttpOnly cookie the API sets on verify (`cookie: true`), so no script on the
 * page can read it; localStorage only remembers who is signed in
 * ({address, isAdmin, expiresAt}) and that record is checked against
 * /api/auth/me once per load, so a cookie that is gone clears it.
 * Connecting a wallet and signing in are one step (connect()): the signature
 * request opens right after the wallet connects. A restored wallet or failed
 * signature can leave it connected without a session; protected actions still
 * require SIWE. Only explicit sign-out disconnects the wallet: revoking wallet
 * permissions automatically can interrupt a sign-in in another tab.
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type Connector,
  useAccount,
  useConfig,
  useConnect,
  useDisconnect,
  useSignMessage,
} from "wagmi";
import { getConnection, switchChain } from "wagmi/actions";
import { createSiweMessage } from "viem/siwe";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearPrivateQueries,
  deletePrivateDraft,
  flushPrivateDrafts,
  hasPrivateDraft,
  preserveLegacyDraft,
} from "~/lib/browser-privacy";
import { api, ApiError } from "~/lib/api";
import type { Me, SessionInfo } from "~/lib/api-types";
import { migrateLegacySession, SESSION_KEY as KEY } from "~/lib/session-migration";
import DraftLogoutDialog, { type DraftLogoutChoice } from "~/components/wallet/DraftLogoutDialog";

/** Viewer and authorization scope. Credential renewal preserves this viewer's UI. */
export const sessionKey = (s: SessionInfo | null | undefined): string | null =>
  s ? `${s.address.toLowerCase()}:${s.isAdmin}` : null;

/** The server refused the signed message because its issuedAt is older than
 * its clock-skew window (the wallet prompt sat open too long). */
const isStaleMessage = (e: unknown) =>
  e instanceof ApiError && e.status === 401 && e.message === "issuedAt out of window";

/** Dev-only fake wallet: it cannot sign, so it connects without a session. */
const skipsSignIn = (c: Connector | undefined) => c?.id === "mock";

/** How long a sign-in over WalletConnect waits for the wallet. The request
 * lives 15 minutes, and a wallet that dropped the session never answers it. */
const WALLET_CONNECT_ANSWER_MS = 90_000;

/** WalletConnect's disconnect() throws before it deletes its stored session
 * when the relay is unreachable, so the next connect() and every reload would
 * restore that session. Delete it locally. */
async function dropWalletConnectSession(c: Connector) {
  if (c.id !== "walletConnect") return;
  try {
    const provider = await c.getProvider() as
      | { signer?: { cleanup?(): Promise<void> } }
      | undefined;
    await provider?.signer?.cleanup?.();
  } catch { /* nothing stored */ }
}

function load(): SessionInfo | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as SessionInfo | null;
    if (
      !s || typeof s.address !== "string" || typeof s.expiresAt !== "number" ||
      s.expiresAt * 1000 < Date.now()
    ) return null;
    return { address: s.address, isAdmin: Boolean(s.isAdmin), expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

function save(s: SessionInfo | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}

/** An expired identity is only a draft-owner hint, never an authenticated session. */
function storedWallet(): string | undefined {
  try {
    const address = JSON.parse(localStorage.getItem(KEY) || "null")?.address;
    return typeof address === "string" ? address.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

interface SessionCtx {
  session: SessionInfo | null;
  me: Me | null;
  signingIn: boolean;
  /** True from the wallet prompt until sign-in has settled (connect()). */
  connecting: boolean;
  /** Connected wallet address (may differ from session.address until sign-in). */
  address: string | undefined;
  /** Connect the wallet and sign in with it in one go. A failed sign-in keeps
   * the wallet connected for a retry, without granting a session. */
  connect(connector: Connector): Promise<void>;
  /** Drop a connection the wallet has not answered yet (an unscanned
   * WalletConnect pairing), so another method can start. False once the
   * wallet has connected: its sign-in has to settle first. */
  cancelPairing(): boolean;
  signIn(account?: `0x${string}`): Promise<SessionInfo>;
  /** Ask about an unfinished draft before logout; false means the user cancelled. */
  signOut(beforeLogout?: () => Promise<void>): Promise<boolean>;
  /** End this session for a wallet switch, retaining every wallet's draft. */
  switchWallet(): Promise<void>;
  /** Session for the connected wallet, signing in first if needed. */
  requireSession(): Promise<SessionInfo>;
  refreshMe(): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

const noop = () => () => {};
/** False for the hydration render (matching the prerendered, signed-out HTML), true after. */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const config = useConfig();
  const { address, status, connector } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [stored, setSession] = useState<SessionInfo | null>(
    () => (typeof localStorage === "undefined" ? null : load()),
  );
  // Prerendered pages were built signed out. Show consumers the stored
  // session only after hydration so their first render matches that HTML;
  // requests carry the cookie regardless.
  const hydrated = useHydrated();
  const session = hydrated ? stored : null;
  const [me, setMe] = useState<Me | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // React state is for rendering. These synchronous guards own the wallet
  // requests, including the gap before React commits a busy-state update.
  const connectingRef = useRef<
    {
      connector: Connector;
      promise: Promise<void>;
      /** Still waiting for the wallet to connect, before any SIWE request. */
      pairing: boolean;
      cancel(): void;
    } | null
  >(null);
  const signingInRef = useRef<
    {
      account: string;
      connector: Connector | undefined;
      promise: Promise<SessionInfo>;
      /** Set for WalletConnect, whose wallet may never answer. */
      cancel?: () => void;
    } | null
  >(null);
  const authGeneration = useRef(0);
  const sessionRef = useRef(stored);
  sessionRef.current = stored;
  const legacyDraftOwner = useRef(storedWallet());
  const [logoutPrompt, setLogoutPrompt] = useState<
    {
      wallet: string;
      resolve: (choice: DraftLogoutChoice) => void;
    } | null
  >(null);
  const pendingLogout = useRef<Promise<boolean> | null>(null);

  const clear = useCallback((rememberExpiredIdentity = false) => {
    const previous = sessionRef.current;
    flushPrivateDrafts();
    if (legacyDraftOwner.current) preserveLegacyDraft(legacyDraftOwner.current);
    authGeneration.current++;
    sessionRef.current = null;
    clearPrivateQueries(qc);
    setSession(null);
    setMe(null);
    // An expired identity is a recovery hint; retained drafts are always wallet-scoped.
    save(
      rememberExpiredIdentity && previous ? { ...previous, isAdmin: false, expiresAt: 0 } : null,
    );
  }, [qc]);
  // Forget the session here and end it on the API too (clearing the cookie),
  // so a browser whose wallet moved on does not keep acting as the old address.
  const drop = useCallback(() => {
    void api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clear();
  }, [clear]);

  const refreshMe = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) {
      setMe(null);
      return;
    }
    try {
      const m = await api<Me>("/api/auth/me", { passive: true });
      if (sessionRef.current !== s) return;
      if (m.address.toLowerCase() !== s.address.toLowerCase()) {
        clear();
        return;
      }
      if (legacyDraftOwner.current === s.address.toLowerCase()) preserveLegacyDraft(s.address);
      setMe(m);
      // The API may remove privileges; newly granted privileges need another sign-in.
      if (m.isAdmin !== s.isAdmin && sessionKey(sessionRef.current) === sessionKey(s)) {
        const next = { ...s, isAdmin: m.isAdmin };
        clearPrivateQueries(qc);
        sessionRef.current = next;
        setSession(next);
        save(next);
      }
    } catch (e) {
      if (sessionRef.current === s && e instanceof ApiError && e.status === 401) clear(true);
    }
  }, [clear, qc]);

  // Notice remote revocation/role changes without keeping an idle session alive.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "hidden") void refreshMe();
    };
    const timer = setInterval(check, 60_000);
    globalThis.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refreshMe]);

  // Validate the stored session once; drop it when the wallet moves. wagmi
  // (ssr mode) mounts as "disconnected" and only then reconnects, so a
  // disconnect counts as settled once a reconnect attempt has been seen.
  // A record from before the cookie (it still carries the bearer) is first
  // exchanged for the cookie, so nobody signed in at the switch is signed out;
  // queries that already ran without the cookie are then refetched.
  useEffect(() => {
    let active = true;
    const original = sessionRef.current;
    void (async () => {
      const r = await migrateLegacySession(localStorage);
      if (!active || sessionRef.current !== original) return;
      if (r.kind === "migrated") {
        sessionRef.current = r.session;
        setSession(r.session);
        await qc.invalidateQueries();
      } else if (r.kind === "cleared") clear();
      await refreshMe();
    })();
    return () => {
      active = false;
    };
  }, [refreshMe, clear, qc]);

  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key !== KEY && e.key !== null) return;
      // A different tab changed the shared cookie. Drop this tab's private state first.
      authGeneration.current++;
      clearPrivateQueries(qc);
      const next = load();
      flushPrivateDrafts();
      if (legacyDraftOwner.current) preserveLegacyDraft(legacyDraftOwner.current);
      sessionRef.current = next;
      setSession(next);
      setMe(null);
      void refreshMe();
    };
    globalThis.addEventListener("storage", changed);
    return () => globalThis.removeEventListener("storage", changed);
  }, [qc, refreshMe]);
  const walletLive = useRef(false);
  useEffect(() => {
    if (status !== "disconnected") walletLive.current = true;
    const s = sessionRef.current;
    if (!s) return;
    if (
      (status === "disconnected" && walletLive.current) ||
      (address && address.toLowerCase() !== s.address.toLowerCase())
    ) {
      drop();
    }
  }, [address, status, drop]);

  // Pairings dropped for another method (cancelPairing). WalletConnect cannot
  // abort one, so its wallet can still approve it later, and wagmi then makes
  // it the current connection. Undo that before React renders, so the chosen
  // wallet and its session stay in place, then end the stray session.
  const dropped = useRef(new Set<string>());
  useEffect(() =>
    config.subscribe((state) => state.current, (current, previous) => {
      if (!current || !dropped.current.delete(current)) return;
      const stray = config.state.connections.get(current)?.connector;
      config.setState((x) => {
        const connections = new Map(x.connections);
        connections.delete(current);
        const back = previous && connections.has(previous)
          ? previous
          : connections.keys().next().value ?? null;
        return { ...x, connections, current: back, status: back ? "connected" : "disconnected" };
      });
      if (!stray) return;
      const { events } = config._internal;
      stray.emitter.off("change", events.change);
      stray.emitter.off("disconnect", events.disconnect);
      stray.emitter.on("connect", events.connect);
      void stray.disconnect().catch(() => dropWalletConnectSession(stray));
    }), [config]);

  const signIn = useCallback(
    (
      account: `0x${string}` | undefined = address,
      signingConnector: Connector | undefined = connector,
    ): Promise<SessionInfo> => {
      if (!account) return Promise.reject(new Error("Connect a wallet first."));
      const active = signingInRef.current;
      if (active) {
        if (
          active.account === account.toLowerCase() &&
          active.connector?.uid === signingConnector?.uid
        ) return active.promise;
        return Promise.reject(new Error("Finish the pending wallet sign-in first."));
      }
      setSigningIn(true);
      const generation = authGeneration.current;
      let stopped = false;
      const stillActive = () => {
        if (stopped || generation !== authGeneration.current) {
          throw new Error("Sign-in was cancelled.");
        }
      };
      let stop: (e: Error) => void = () => {};
      const stopping = new Promise<never>((_, reject) => stop = reject);
      const halt = (e: Error) => {
        stopped = true;
        stop(e);
      };
      const attempt = async (): Promise<SessionInfo> => {
        const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
        const message = createSiweMessage({
          domain: globalThis.location.host,
          address: account,
          uri: globalThis.location.origin,
          version: "1",
          chainId: 1,
          nonce,
          statement: "Sign in to TheDAO Security Fund",
          issuedAt: new Date(),
        });
        // The message says chain 1 and the API verifies it there (EIP-1271 for
        // smart accounts), so the wallet must be on Ethereum before it signs.
        // Ambire keeps a chain per site and refuses personal_sign (EIP-1193
        // 4901) while that chain is not one of its enabled networks; a switch
        // request is what resets it.
        const onChain = signingConnector
          ? await signingConnector.getChainId()
          : getConnection(config).chainId;
        if (onChain !== 1) await switchChain(config, { chainId: 1, connector: signingConnector });
        const signature = await signMessageAsync({ message, account, connector: signingConnector });
        stillActive();
        // cookie: true -> the token comes back as an HttpOnly cookie, not in the body.
        return await api<SessionInfo>("/api/auth/verify", {
          json: { message, signature, cookie: true },
        });
      };
      const work = Promise.resolve().then(async () => {
        let s: SessionInfo;
        try {
          s = await attempt();
        } catch (e) {
          // The timestamp is part of what the wallet signed, so a prompt left
          // open past the server's window can only be fixed by signing again.
          if (!isStaleMessage(e)) throw e;
          stillActive();
          s = await attempt();
        }
        stillActive();
        if (
          sessionRef.current?.address.toLowerCase() !== s.address.toLowerCase() ||
          sessionRef.current?.isAdmin !== s.isAdmin
        ) clearPrivateQueries(qc);
        flushPrivateDrafts();
        if (legacyDraftOwner.current) preserveLegacyDraft(legacyDraftOwner.current);
        setSession(s);
        save(s);
        sessionRef.current = s;
        await refreshMe();
        return s;
      });
      const walletConnect = signingConnector?.id === "walletConnect";
      const timer = walletConnect
        ? setTimeout(
          () =>
            halt(
              new Error(
                "Your wallet did not answer. Start a new connection, or use another method.",
              ),
            ),
          WALLET_CONNECT_ANSWER_MS,
        )
        : undefined;
      const release = () => {
        if (signingInRef.current !== entry) return;
        signingInRef.current = null;
        setSigningIn(false);
      };
      const promise = Promise.race([work, stopping]).finally(() => {
        clearTimeout(timer);
        release();
      });
      void work.catch(() => {});
      const entry: NonNullable<typeof signingInRef.current> = {
        account: account.toLowerCase(),
        connector: signingConnector,
        promise,
        cancel: walletConnect
          ? () => {
            halt(new Error("Sign-in was cancelled."));
            release();
          }
          : undefined,
      };
      signingInRef.current = entry;
      return promise;
    },
    [address, connector, config, signMessageAsync, refreshMe, qc],
  );

  /** Ends a wallet connection. wagmi keeps a connection whose disconnect()
   * throws (WalletConnect while its relay is unreachable), so drop it here. */
  const endConnection = useCallback(async (c: Connector) => {
    try {
      await disconnectAsync({ connector: c });
      return;
    } catch { /* dropped below */ }
    await dropWalletConnectSession(c);
    const { events } = config._internal;
    c.emitter.off("change", events.change);
    c.emitter.off("disconnect", events.disconnect);
    c.emitter.on("connect", events.connect);
    config.setState((x) => {
      if (!x.connections.has(c.uid)) return x;
      const connections = new Map(x.connections);
      connections.delete(c.uid);
      if (x.current !== c.uid) return { ...x, connections };
      const current = connections.keys().next().value ?? null;
      return { ...x, connections, current, status: current ? "connected" : "disconnected" };
    });
  }, [config, disconnectAsync]);

  const endSession = useCallback(async () => {
    const s = sessionRef.current;
    clear(); // Clear locally immediately, even if logout is slow or offline.
    if (s) {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch { /* already gone */ }
    }
    // A wallet picked in the chooser while another was still connected (a
    // restored one without a session) leaves both in wagmi, which falls back
    // to the older one when the current one disconnects. End every connection.
    for (const { connector } of [...config.state.connections.values()]) {
      await endConnection(connector);
    }
  }, [clear, config, endConnection]);

  const chooseLogout = useCallback((choice: DraftLogoutChoice) => {
    logoutPrompt?.resolve(choice);
    setLogoutPrompt(null);
  }, [logoutPrompt]);

  useEffect(() => {
    if (logoutPrompt && logoutPrompt.wallet !== session?.address.toLowerCase()) {
      chooseLogout("cancel");
    }
  }, [session?.address, logoutPrompt, chooseLogout]);

  const signOut = useCallback((beforeLogout?: () => Promise<void>): Promise<boolean> => {
    if (pendingLogout.current) return pendingLogout.current;
    const generation = authGeneration.current;
    const wallet = sessionRef.current?.address.toLowerCase();
    flushPrivateDrafts();
    if (legacyDraftOwner.current) preserveLegacyDraft(legacyDraftOwner.current);
    const promise = Promise.resolve().then(async () => {
      const choice = wallet && hasPrivateDraft(wallet)
        ? await new Promise<DraftLogoutChoice>((resolve) => setLogoutPrompt({ wallet, resolve }))
        : "keep";
      if (choice === "cancel" || generation !== authGeneration.current) return false;
      await beforeLogout?.();
      if (generation !== authGeneration.current) return false;
      if (choice === "delete" && wallet) deletePrivateDraft(wallet);
      await endSession();
      return true;
    }).finally(() => {
      pendingLogout.current = null;
    });
    pendingLogout.current = promise;
    return promise;
  }, [endSession]);

  const connect = useCallback((c: Connector): Promise<void> => {
    const active = connectingRef.current;
    if (active) {
      if (active.connector.uid === c.uid) return active.promise;
      return Promise.reject(new Error("Finish the pending wallet connection first."));
    }
    if (signingInRef.current) {
      return Promise.reject(new Error("Finish the pending wallet sign-in first."));
    }
    setConnecting(true);
    let rejectCancelled: (e: Error) => void = () => {};
    const cancelledPromise = new Promise<never>((_, reject) => rejectCancelled = reject);
    const entry: NonNullable<typeof connectingRef.current> = {
      connector: c,
      promise: cancelledPromise,
      pairing: true,
      cancel() {
        entry.pairing = false;
        dropped.current.add(c.uid);
        rejectCancelled(new Error("Connection cancelled."));
        connectingRef.current = null;
        setConnecting(false);
      },
    };
    const run = async () => {
      // wagmi restores a WalletConnect session from storage without asking the
      // wallet, which may have dropped it. SIWE over it can hang unseen on a
      // phone, and only a new pairing gives the QR code and the deep links.
      if (c.id === "walletConnect" && config.state.connections.has(c.uid)) {
        await endConnection(c);
      }
      // A restored wallet or a refused signature may already be connected.
      // Retry SIWE without issuing another permission request to that wallet.
      const current = getConnection(config);
      const { accounts } =
        current.isConnected && current.address && current.connector?.uid === c.uid
          ? { accounts: [current.address] }
          : await connectAsync({ connector: c, chainId: 1 });
      // Dropped while pairing: the effect above has already undone it.
      if (connectingRef.current !== entry) throw new Error("Connection cancelled.");
      entry.pairing = false;
      if (skipsSignIn(c)) return;
      await signIn(accounts[0], c);
    };
    connectingRef.current = entry;
    dropped.current.delete(c.uid);
    entry.promise = Promise.race([
      run().catch((e) => {
        if (connectingRef.current !== entry) dropped.current.delete(c.uid);
        throw e;
      }),
      cancelledPromise,
    ]).finally(() => {
      if (connectingRef.current !== entry) return;
      connectingRef.current = null;
      setConnecting(false);
    });
    return entry.promise;
  }, [config, connectAsync, endConnection, signIn]);

  const cancelPairing = useCallback(() => {
    const active = connectingRef.current;
    const signing = signingInRef.current;
    if (signing) {
      // A WalletConnect sign-in may wait on a wallet that dropped the session.
      if (!signing.cancel) return false;
      signing.cancel();
      // connect() then rejects with the sign-in; free its slot now so another
      // method can start before that settles.
      if (active) {
        connectingRef.current = null;
        setConnecting(false);
      }
      return true;
    }
    if (!active) return true;
    if (!active.pairing) return false;
    active.cancel();
    return true;
  }, []);

  // Wallet events are broadcast to every tab on this origin. An idle tab must
  // neither prompt for SIWE nor revoke account permissions on those events.
  // The wallet-move effect above clears obsolete sessions; signing in is an
  // explicit action through connect(), signIn(), or requireSession().

  const requireSession = useCallback(async () => {
    const s = sessionRef.current;
    if (s && address && s.address.toLowerCase() === address.toLowerCase()) return s;
    return await signIn();
  }, [address, signIn]);

  const value = useMemo<SessionCtx>(
    () => ({
      session,
      me,
      signingIn,
      connecting,
      address,
      connect,
      cancelPairing,
      signIn,
      signOut,
      switchWallet: endSession,
      requireSession,
      refreshMe,
    }),
    [
      session,
      me,
      signingIn,
      connecting,
      address,
      connect,
      cancelPairing,
      signIn,
      signOut,
      endSession,
      requireSession,
      refreshMe,
    ],
  );
  return (
    <Ctx.Provider value={value}>
      <Fragment key={session ? session.address.toLowerCase() : "anonymous"}>
        {children}
      </Fragment>
      <DraftLogoutDialog open={Boolean(logoutPrompt)} onChoose={chooseLogout} />
    </Ctx.Provider>
  );
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
