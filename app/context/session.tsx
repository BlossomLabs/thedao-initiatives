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
import { api, ApiError } from "~/lib/api";
import type { Me, SessionInfo } from "~/lib/api-types";
import { migrateLegacySession, SESSION_KEY as KEY } from "~/lib/session-migration";

/** Identifies a sign-in (a new one gets a new expiry), for effects and query
 * keys that must react to "someone else is signed in now". */
export const sessionKey = (s: SessionInfo | null | undefined): string | null =>
  s ? `${s.address.toLowerCase()}:${s.expiresAt}` : null;

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
  /** Ends the session and disconnects the wallet. */
  signOut(): Promise<void>;
  /** Session for the connected wallet, signing in first if needed. */
  requireSession(): Promise<SessionInfo>;
  refreshMe(): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

const noop = () => () => {};
/** False for the hydration render (matching the prerendered, signed-out HTML), true after. */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export function SessionProvider({ children }: { children: React.ReactNode }) {
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
  const sessionRef = useRef(stored);
  sessionRef.current = stored;

  const clear = useCallback(() => {
    setSession(null);
    setMe(null);
    save(null);
  }, []);
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
      const m = await api<Me>("/api/auth/me");
      setMe(m);
      // The admin flag follows the API's current admin list, not sign-in time.
      if (m.isAdmin !== s.isAdmin && sessionKey(sessionRef.current) === sessionKey(s)) {
        const next = { ...s, isAdmin: m.isAdmin };
        setSession(next);
        save(next);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) clear();
    }
  }, [clear]);

  // Validate the stored session once; drop it when the wallet moves. wagmi
  // (ssr mode) mounts as "disconnected" and only then reconnects, so a
  // disconnect counts as settled once a reconnect attempt has been seen.
  // A record from before the cookie (it still carries the bearer) is first
  // exchanged for the cookie, so nobody signed in at the switch is signed out;
  // queries that already ran without the cookie are then refetched.
  const qc = useQueryClient();
  useEffect(() => {
    void (async () => {
      const r = await migrateLegacySession(localStorage);
      if (r.kind === "migrated") {
        sessionRef.current = r.session;
        setSession(r.session);
        await qc.invalidateQueries();
      } else if (r.kind === "cleared") clear();
      await refreshMe();
    })();
  }, [refreshMe, clear, qc]);
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
    async (account: `0x${string}` | undefined = address): Promise<SessionInfo> => {
      if (!account) throw new Error("Connect a wallet first.");
      setSigningIn(true);
      try {
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
        const signature = await signMessageAsync({ message, account });
        // cookie: true -> the token comes back as an HttpOnly cookie, not in the body.
        const s = await api<SessionInfo>("/api/auth/verify", {
          json: { message, signature, cookie: true },
        });
        setSession(s);
        save(s);
        sessionRef.current = s;
        await refreshMe();
        return s;
      } finally {
        setSigningIn(false);
      }
    },
    [address, signMessageAsync, refreshMe],
  );

  const signOut = useCallback(async () => {
    const s = sessionRef.current;
    if (s) {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch { /* already gone */ }
    }
    clear();
    try {
      await disconnectAsync();
    } catch { /* not connected */ }
  }, [clear, disconnectAsync]);

  const connect = useCallback(async (c: Connector) => {
    setConnecting(true);
    try {
      const { accounts } = await connectAsync({ connector: c, chainId: 1 });
      if (skipsSignIn(c)) return;
      try {
        await signIn(accounts[0]);
      } catch (e) {
        await disconnectAsync({ connector: c }).catch(() => {});
        throw e;
      }
    } finally {
      setConnecting(false);
    }
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
    if (connecting || signingIn) return; // connect() signs in right after connecting
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
      requireSession,
      refreshMe,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
