/**
 * SIWE session: one signature per session, stored as a bearer token.
 * Sign-in is only prompted when an action needs it (requireSession()).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { api, ApiError, setTokenProvider } from "~/lib/api";
import type { Me, SessionInfo } from "~/lib/api-types";

const KEY = "thedao:session";

function load(): SessionInfo | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as SessionInfo | null;
    if (!s || typeof s.token !== "string" || s.expiresAt * 1000 < Date.now()) return null;
    return s;
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
  /** Connected wallet address (may differ from session.address until sign-in). */
  address: string | undefined;
  signIn(): Promise<SessionInfo>;
  signOut(): Promise<void>;
  /** Session for the connected wallet, signing in first if needed. */
  requireSession(): Promise<SessionInfo>;
  refreshMe(): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { address, status } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<SessionInfo | null>(
    () => (typeof localStorage === "undefined" ? null : load()),
  );
  const [me, setMe] = useState<Me | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Registered during render, not in an effect: child queries fire their first
  // request before a parent effect would run, and must already carry the bearer.
  setTokenProvider(() => sessionRef.current?.token ?? null);

  const clear = useCallback(() => {
    setSession(null);
    setMe(null);
    save(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<Me>("/api/auth/me", { token: s.token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) clear();
    }
  }, [clear]);

  // Validate the stored session once; drop it when the wallet moves. wagmi
  // starts as "reconnecting" on a reload, so only a settled disconnect counts.
  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);
  useEffect(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (
      status === "disconnected" || (address && address.toLowerCase() !== s.address.toLowerCase())
    ) {
      clear();
    }
  }, [address, status, clear]);

  const signIn = useCallback(async (): Promise<SessionInfo> => {
    if (!address) throw new Error("Connect a wallet first.");
    setSigningIn(true);
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce", { token: null });
      const message = createSiweMessage({
        domain: globalThis.location.host,
        address,
        uri: globalThis.location.origin,
        version: "1",
        chainId: 1,
        nonce,
        statement: "Sign in to TheDAO Security Fund",
        issuedAt: new Date(),
      });
      const signature = await signMessageAsync({ message });
      const s = await api<SessionInfo>("/api/auth/verify", {
        json: { message, signature },
        token: null,
      });
      setSession(s);
      save(s);
      sessionRef.current = s;
      await refreshMe();
      return s;
    } finally {
      setSigningIn(false);
    }
  }, [address, signMessageAsync, refreshMe]);

  const signOut = useCallback(async () => {
    const s = sessionRef.current;
    if (s) {
      try {
        await api("/api/auth/logout", { method: "POST", token: s.token });
      } catch { /* already gone */ }
    }
    clear();
  }, [clear]);

  const requireSession = useCallback(async () => {
    const s = sessionRef.current;
    if (s && address && s.address.toLowerCase() === address.toLowerCase()) return s;
    return await signIn();
  }, [address, signIn]);

  const value = useMemo<SessionCtx>(
    () => ({ session, me, signingIn, address, signIn, signOut, requireSession, refreshMe }),
    [session, me, signingIn, address, signIn, signOut, requireSession, refreshMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
