import { useMemo } from "react";
import { type Connector, useConnect } from "wagmi";
import { MOCK_WALLET } from "~/lib/wallet-env";

/**
 * Connectors worth offering: the dev mock only when configured, and the
 * generic "Injected" entry only until EIP-6963 announced a named wallet.
 */
export function useConnectors(): Connector[] {
  const { connectors } = useConnect();
  return useMemo(() => {
    const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
    return connectors.filter((c) =>
      (c.id !== "mock" || MOCK_WALLET) && (c.id !== "injected" || !named)
    );
  }, [connectors]);
}
