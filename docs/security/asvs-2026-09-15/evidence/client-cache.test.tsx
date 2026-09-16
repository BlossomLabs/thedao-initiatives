/** Assessment reproductions. These assert the observed weaknesses, not desired behavior. */
import { cleanup, renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { mainnet } from "viem/chains";
import { api } from "~/lib/api";
import { SessionProvider, useSession } from "~/context/session";
import { SESSION_KEY } from "~/lib/session-migration";
import { revisionKey, useRevision } from "~/hooks/use-revision";

vi.mock("~/lib/api", async original => ({ ...await original<typeof import("~/lib/api")>(), api: vi.fn() }));
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

it("ASVS-12: logout leaves private application data in the query cache", async () => {
  const session = { address: "0x1111111111111111111111111111111111111111", isAdmin: true, expiresAt: 9999999999 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  vi.mocked(api).mockImplementation(async path => {
    if (path === "/api/auth/me") return { ...session, nickname: null, pfp: "", pfpUrl: "" };
    if (path === "/api/auth/logout") return { ok: true };
    throw new Error("Unexpected mocked request: " + path);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["admin", "leads"], { rows: [{ funders: "ASSESSMENT_PRIVATE_FIXTURE" }] });
  const config = createConfig({ chains: [mainnet], connectors: [], transports: { [mainnet.id]: http() } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config}><QueryClientProvider client={qc}><SessionProvider>{children}</SessionProvider></QueryClientProvider></WagmiProvider>
  );
  const { result } = renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.session?.isAdmin).toBe(true));
  await act(async () => { await result.current.signOut(); });
  expect(result.current.session).toBeNull();
  expect(qc.getQueryData(["admin", "leads"])).toEqual({ rows: [{ funders: "ASSESSMENT_PRIVATE_FIXTURE" }] });
  qc.clear();
});

it("ASVS-12: a cached restricted revision is reused without checking the new viewer", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const revision = { n: 1, archived: true, title: "ASSESSMENT_PRIVATE_REVISION" };
  qc.setQueryData(revisionKey("asvs-local-fixture", 1), revision);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useRevision("asvs-local-fixture", 1), { wrapper });
  expect(result.current.data).toEqual(revision);
  expect(api).not.toHaveBeenCalled();
  qc.clear();
});
