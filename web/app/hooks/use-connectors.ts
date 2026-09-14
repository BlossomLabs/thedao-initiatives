import { useMemo } from "react";
import { type Connector, useConnect } from "wagmi";
import { MOCK_WALLET } from "~/lib/wagmi";

/** EIP-6963 id MetaMask's extension announces itself under. */
const METAMASK_INJECTED_ID = "io.metamask";

/**
 * Connectors worth offering: the dev mock only when configured, the generic
 * "Injected" entry only until EIP-6963 announced a named wallet, and the
 * MetaMask SDK entry (deep link / QR) only while the extension is not here.
 */
export function useConnectors(): Connector[] {
  const { connectors } = useConnect();
  return useMemo(() => {
    const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
    const extension = connectors.some((c) => c.id === METAMASK_INJECTED_ID);
    return connectors.filter((c) =>
      (c.id !== "mock" || MOCK_WALLET) && (c.id !== "injected" || !named) &&
      (c.type !== "metaMask" || !extension)
    );
  }, [connectors]);
}
