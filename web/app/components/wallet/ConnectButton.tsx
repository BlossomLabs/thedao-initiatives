import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useSession } from "~/context/session";
import { useIdentity } from "~/hooks/use-identity";
import { useBoard } from "~/hooks/use-board";
import { Avatar } from "./Avatar";
import WalletMenu, { connectorIcon, type WalletMenuItem } from "./WalletMenu";
import NicknameDialog from "./NicknameDialog";
import { errorMessage } from "~/lib/api";
import { walletErrorMessage } from "~/lib/donate";
import { cn } from "~/lib/utils";
import { MOCK_WALLET } from "~/lib/wagmi";

const PROMPTED_KEY = "thedao:name-prompted";

/**
 * Top-bar wallet button. Disconnected: opens the connector list (or connects
 * directly when only one wallet exists). Connected: account menu with
 * sign-in, name/picture, switch wallet, disconnect.
 */
export default function ConnectButton() {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { session, signIn, signOut, signingIn } = useSession();
  const identity = useIdentity(address);
  const board = useBoard();
  const [menu, setMenu] = useState<"none" | "pick" | "account">("none");
  const [nickOpen, setNickOpen] = useState(false);
  const [firstTime, setFirstTime] = useState(false);
  const [error, setError] = useState("");

  // Hide the generic "Injected" entry once EIP-6963 announced a named wallet.
  const usable = useMemo(() => {
    const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
    return connectors.filter((c) =>
      (c.id !== "mock" || MOCK_WALLET) && (c.id !== "injected" || !named)
    );
  }, [connectors]);

  // Offer a name once per wallet when it has none (MVP behaviour).
  useEffect(() => {
    if (!isConnected || !address || identity.loading || identity.nickname) return;
    try {
      const done = JSON.parse(localStorage.getItem(PROMPTED_KEY) || "{}") as Record<
        string,
        boolean
      >;
      if (done[address.toLowerCase()]) return;
      done[address.toLowerCase()] = true;
      localStorage.setItem(PROMPTED_KEY, JSON.stringify(done));
    } catch {
      return;
    }
    setFirstTime(true);
    setNickOpen(true);
  }, [isConnected, address, identity.loading, identity.nickname]);

  async function connectWith(c: (typeof connectors)[number]) {
    setError("");
    try {
      await connectAsync({ connector: c, chainId: 1 });
    } catch (e) {
      setError("Not connected: " + walletErrorMessage(e));
    }
  }

  function onClick() {
    setError("");
    if (isConnected) {
      setMenu(menu === "account" ? "none" : "account");
      return;
    }
    if (usable.length === 1) void connectWith(usable[0]);
    else setMenu(menu === "pick" ? "none" : "pick");
  }

  const pickItems: WalletMenuItem[] = usable.map((c) => ({
    key: c.uid,
    label: c.name,
    icon: connectorIcon(c),
    lucide: connectorIcon(c) ? undefined : "wallet",
    onClick: () => void connectWith(c),
  }));

  const accountItems: WalletMenuItem[] = [
    ...(session
      ? [{
        key: "signed",
        label: "Signed in" + (session.isAdmin ? " (admin)" : ""),
        lucide: "sign" as const,
        active: true,
        onClick: () => {},
      }]
      : [{
        key: "sign",
        label: signingIn ? "Check your wallet…" : "Sign in",
        lucide: "sign" as const,
        onClick: () => void signIn().catch((e) => setError(errorMessage(e))),
      }]),
    {
      key: "name",
      label: identity.nickname ? "Change name or picture" : "Set a display name",
      lucide: "edit",
      onClick: () => {
        setFirstTime(false);
        setNickOpen(true);
      },
    },
    ...usable.filter((c) => c.uid !== connector?.uid).map((c) => ({
      key: "sw-" + c.uid,
      label: "Switch to " + c.name,
      icon: connectorIcon(c),
      lucide: connectorIcon(c) ? undefined : ("switch" as const),
      onClick: () => void disconnectAsync().then(() => connectWith(c)),
    })),
    ...(session
      ? [{
        key: "out",
        label: "Sign out",
        lucide: "power" as const,
        separator: true,
        onClick: () => void signOut(),
      }]
      : []),
    {
      key: "disc",
      label: "Disconnect wallet",
      lucide: "power",
      danger: true,
      separator: !session,
      onClick: () => void disconnectAsync().then(() => signOut()),
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        className={cn("btn btn-wallet", isConnected && "connected")}
        onClick={onClick}
        disabled={isPending}
        aria-haspopup="menu"
        aria-expanded={menu !== "none"}
      >
        {isConnected && address
          ? <Avatar src={identity.avatar} size={20} />
          : <Wallet className="size-4 opacity-80" />}
        {isPending ? "Connecting…" : isConnected && address ? identity.name : "Connect wallet"}
      </button>
      {menu === "pick" && <WalletMenu items={pickItems} onClose={() => setMenu("none")} />}
      {menu === "account" && <WalletMenu items={accountItems} onClose={() => setMenu("none")} />}
      {error && (
        <div
          className="absolute right-0 top-[46px] z-[60] max-w-[300px] rounded-xl border border-[rgba(255,59,56,.55)] bg-panel px-3 py-2 text-[12.5px] text-[#ffd7d6] shadow-menu"
          role="alert"
          onClick={() => setError("")}
        >
          {error}
        </div>
      )}
      <NicknameDialog
        open={nickOpen}
        onOpenChange={setNickOpen}
        firstTime={firstTime}
        uploadsEnabled={board.data?.flags.uploads}
      />
    </div>
  );
}
