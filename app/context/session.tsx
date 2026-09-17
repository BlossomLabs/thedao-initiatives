/**
 * SIWE session: one signature per session. The token itself lives in an
 * HttpOnly cookie the API sets on verify (`cookie: true`), so no script on the
 * page can read it; localStorage only remembers who is signed in
 * ({address, isAdmin, expiresAt}) and that record is checked against
 * /api/auth/me once per load, so a cookie that is gone clears it.
 * Connecting a wallet and signing in are one step (connect()): the signature
 * request opens right after the wallet connects, and a refused or dismissed
 * signature disconnects the wallet again, so a connected address is always a
 * signed-in one. A stored session survives reloads; a reconnected wallet
 * without one is dropped.
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
import { type Connector, useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
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

/** Dev-only fake wallet: it cannot sign, so it connects without a session. */
const skipsSignIn = (c: Connector | undefined) => c?.id === "mock";

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
  /** Connect the wallet and sign in with it in one go. On a refused signature
   * the wallet is disconnected again and the error rethrown. */
  connect(connector: Connector): Promise<void>;
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
  const connectingRef = useRef<{ connector: Connector; promise: Promise<void> } | null>(null);
  const signingInRef = useRef<
    {
      account: string;
      connector: Connector | undefined;
      promise: Promise<SessionInfo>;
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
      const stillActive = () => {
        if (generation !== authGeneration.current) throw new Error("Sign-in was cancelled.");
      };
      const promise = Promise.resolve().then(async () => {
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
        const signature = await signMessageAsync({ message, account, connector: signingConnector });
        stillActive();
        // cookie: true -> the token comes back as an HttpOnly cookie, not in the body.
        const s = await api<SessionInfo>("/api/auth/verify", {
          json: { message, signature, cookie: true },
        });
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
      }).finally(() => {
        signingInRef.current = null;
        setSigningIn(false);
      });
      signingInRef.current = {
        account: account.toLowerCase(),
        connector: signingConnector,
        promise,
      };
      return promise;
    },
    [address, connector, signMessageAsync, refreshMe, qc],
  );

  const endSession = useCallback(async () => {
    const s = sessionRef.current;
    clear(); // Clear locally immediately, even if logout is slow or offline.
    if (s) {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch { /* already gone */ }
    }
    try {
      await disconnectAsync();
    } catch { /* not connected */ }
  }, [clear, disconnectAsync]);

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
    const promise = Promise.resolve().then(async () => {
      const { accounts } = await connectAsync({ connector: c, chainId: 1 });
      if (skipsSignIn(c)) return;
      try {
        await signIn(accounts[0], c);
      } catch (e) {
        await disconnectAsync({ connector: c }).catch(() => {});
        throw e;
      }
    }).finally(() => {
      connectingRef.current = null;
      setConnecting(false);
    });
    connectingRef.current = { connector: c, promise };
    return promise;
  }, [connectAsync, disconnectAsync, signIn]);

  // Keep "connected" meaning "signed in" outside connect(): whenever a wallet is
  // connected with no matching session (reload without a stored session, an
  // expired session dropped by refreshMe, a session for another address), it is
  // either asked to sign in (an account switched inside the wallet) or
  // disconnected, so the UI never shows a connected wallet that cannot act.
  const prev = useRef<{ status: typeof status; address: typeof address }>({ status, address });
  useEffect(() => {
    const before = prev.current;
    prev.current = { status, address };
    if (status !== "connected" || !address || skipsSignIn(connector)) return;
    if (connectingRef.current || signingInRef.current) return;
    const s = sessionRef.current;
    if (s && s.address.toLowerCase() === address.toLowerCase()) return;
    const switched = before.status === "connected" && before.address &&
      before.address.toLowerCase() !== address.toLowerCase();
    if (switched) {
      void signIn(address).catch(() => disconnectAsync().catch(() => {}));
    } else {
      void disconnectAsync().catch(() => {});
    }
  }, [status, address, connector, connecting, signingIn, stored, signIn, disconnectAsync]);

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
