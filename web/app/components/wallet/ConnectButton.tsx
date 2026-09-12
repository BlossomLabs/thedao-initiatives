import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { useNavigate } from "react-router";
import { useAccount } from "wagmi";
import { useSession } from "~/context/session";
import { useProfileDialog } from "~/context/profile-dialog";
import { useEmailSignIn } from "~/context/email-sign-in";
import { useConnectors } from "~/hooks/use-connectors";
import { useIdentity } from "~/hooks/use-identity";
import { Avatar } from "./Avatar";
import WalletMenu, { connectorItem, type WalletMenuItem } from "./WalletMenu";
import { PRIVY_CONNECTOR_ID } from "~/lib/privy";
import { walletErrorMessage } from "~/lib/donate";
import { shortAddr } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * Top-bar wallet button. Disconnected: opens the connector list (or connects
 * directly when only one wallet exists); connecting signs in with Ethereum
 * in the same step, and a dismissed signature leaves the wallet disconnected
 * so the button can simply be clicked again. Connected: account menu with
 * name/picture, switch wallet, sign out.
 */
export default function ConnectButton() {
  const { address, isConnected, connector } = useAccount();
  const usable = useConnectors();
  const { session, connect, connecting, signingIn, signIn, signOut } = useSession();
  // "Connected" in the UI means signed in with this wallet; a bare wagmi
  // connection (the context is about to disconnect or sign it in) shows as not connected.
  const signedIn = Boolean(
    isConnected && address && session && session.address.toLowerCase() === address.toLowerCase(),
  );
  const identity = useIdentity(address);
  const { profileOpen, openProfile } = useProfileDialog();
  const { openEmailSignIn } = useEmailSignIn();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<"none" | "pick" | "account">("none");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  useEffect(() => {
    if (isConnected) setError("");
  }, [isConnected]);
  // Set on a fresh sign-in; consumed once the identity lookups have settled.
  const [promptPending, setPromptPending] = useState(false);
  const lastToken = useRef(session?.token);

  // Detect a sign-in made in this page (a stored session on reload is not one).
  // Skipped while the dialog itself triggered the sign-in on save.
  useEffect(() => {
    const token = session?.token;
    if (token && token !== lastToken.current && !profileOpen) setPromptPending(true);
    lastToken.current = token;
  }, [session?.token, profileOpen]);

  // Once signed in: if ENS and the site profile still leave the name or the
  // picture unset, offer to complete them.
  useEffect(() => {
    if (!promptPending || identity.loading) return;
    if (!session || !address || session.address.toLowerCase() !== address.toLowerCase()) return;
    setPromptPending(false);
    if (identity.hasName && identity.hasAvatar) return;
    openProfile(true);
  }, [
    promptPending,
    identity.loading,
    identity.hasName,
    identity.hasAvatar,
    session,
    address,
    openProfile,
  ]);

  async function connectWith(c: (typeof usable)[number]) {
    setError("");
    if (c.id === PRIVY_CONNECTOR_ID) {
      openEmailSignIn();
      return;
    }
    try {
      await connect(c);
    } catch (e) {
      setError("Not connected: " + walletErrorMessage(e));
    }
  }

  function onClick() {
    setError("");
    if (signedIn) {
      setMenu(menu === "account" ? "none" : "account");
      return;
    }
    if (isConnected && address) {
      // Connected but not signed in (session expired): ask for the signature.
      signIn(address).catch((e) => setError("Not signed in: " + walletErrorMessage(e)));
      return;
    }
    if (usable.length === 1) void connectWith(usable[0]);
    else setMenu(menu === "pick" ? "none" : "pick");
  }

  const pickItems: WalletMenuItem[] = usable.map((c) =>
    connectorItem(c, () => void connectWith(c))
  );

  const accountItems: WalletMenuItem[] = [
    // The connected address, click to copy (Griff, 2026-09-12). Stays open to show "Copied".
    ...(address
      ? [{
        key: "addr",
        label: copied ? "Copied ✓" : shortAddr(address),
        title: address,
        lucide: "copy" as const,
        mono: true,
        keepOpen: true,
        onClick: copyAddress,
      }]
      : []),
    ...(session
      ? [{
        key: "signed",
        label: "Signed in" + (session.isAdmin ? " (admin)" : ""),
        lucide: "sign" as const,
        active: true,
        onClick: () => {},
      }]
      : []),
    ...(session?.isAdmin
      ? [{
        key: "admin",
        label: "Admin panel",
        lucide: "admin" as const,
        onClick: () => void navigate("/admin"),
      }]
      : []),
    {
      key: "name",
      label: identity.nameFromEns && identity.avatarFromEns
        ? "Your name and picture"
        : identity.hasName
        ? "Change name or picture"
        : "Set a display name",
      lucide: "edit",
      onClick: () => openProfile(false),
    },
    ...usable.filter((c) => c.uid !== connector?.uid).map((c) => ({
      ...connectorItem(c, () => void signOut().then(() => connectWith(c)), "Switch to " + c.name),
      key: "sw-" + c.uid,
    })),
    {
      key: "out",
      label: session ? "Sign out" : "Disconnect wallet",
      lucide: "power",
      danger: true,
      separator: true,
      onClick: () => void signOut(),
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        className={cn("btn btn-wallet", signedIn && "connected")}
        onClick={onClick}
        disabled={connecting || signingIn}
        aria-haspopup="menu"
        aria-expanded={menu !== "none"}
      >
        {signedIn
          ? <Avatar src={identity.avatar} size={20} />
          : <Wallet className="size-4 opacity-80" />}
        {connecting || signingIn
          ? "Check your wallet…"
          : signedIn
          ? identity.name
          : "Connect wallet"}
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
    </div>
  );
}
