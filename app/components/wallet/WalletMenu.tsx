import { useEffect, useRef } from "react";
import {
  Copy,
  LayoutDashboard,
  List,
  LogOut,
  Mail,
  Pencil,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { Connector } from "wagmi";
import { PRIVY_CONNECTOR_ID } from "~/lib/privy-store";
import { cn } from "~/lib/utils";
import Pop from "~/components/ui/Pop";

export interface WalletMenuItem {
  key: string;
  label: string;
  icon?: string;
  lucide?: "wallet" | "mail" | "edit" | "power" | "sign" | "admin" | "copy" | "list";
  active?: boolean;
  danger?: boolean;
  separator?: boolean;
  /** Monospace label (an address). */
  mono?: boolean;
  /** Full text for the tooltip (the whole address behind a shortened label). */
  title?: string;
  /** The menu stays open after the click (copy actions that show "Copied"). */
  keepOpen?: boolean;
  onClick: () => void;
}

const ICONS = {
  copy: Copy,
  wallet: Wallet,
  mail: Mail,
  edit: Pencil,
  power: LogOut,
  sign: ShieldCheck,
  admin: LayoutDashboard,
  list: List,
};

/** The MVP's wallet picker / account menu, anchored under the top-bar button. */
export default function WalletMenu(
  { open, items, onClose, className, header }: {
    open: boolean;
    items: WalletMenuItem[];
    onClose: () => void;
    className?: string;
    /** Shown above the items (the ETHSecurity Badge holder note). */
    header?: React.ReactNode;
  },
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <Pop
      show={open}
      ref={ref}
      className={cn(
        "absolute right-0 top-[46px] z-[60] flex min-w-[236px] flex-col overflow-hidden rounded-[14px] border border-edge2 bg-panel p-1.5 shadow-menu",
        className,
      )}
      role="menu"
    >
      {header}
      {items.map((it) => {
        const Icon = it.lucide ? ICONS[it.lucide] : null;
        return (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            className={cn(
              "flex items-center gap-[11px] rounded-[9px] border-0 bg-transparent px-3 py-2.5 text-left font-inter-tight text-[14px] text-soft hover:bg-[rgba(92,183,90,.08)] hover:text-dao-green",
              it.separator && "mt-1.5 border-t border-edge2 pt-3",
              it.active && "text-dao-green",
              it.danger && "text-[#ff9a9a] hover:bg-[rgba(255,90,90,.12)] hover:text-[#ffb3b3]",
            )}
            title={it.title}
            onClick={() => {
              if (!it.keepOpen) onClose();
              it.onClick();
            }}
          >
            {it.icon
              ? <img src={it.icon} alt="" className="size-6 rounded-md object-contain" />
              : Icon
              ? <Icon className="size-[18px] opacity-80" />
              : <span className="size-6" />}
            <span className={cn("flex-1 whitespace-nowrap", it.mono && "mono text-[12.5px]")}>
              {it.label}
              {it.active ? " ✓" : ""}
            </span>
          </button>
        );
      })}
    </Pop>
  );
}

export const connectorIcon = (
  c: Connector,
): string | undefined => (typeof c.icon === "string" ? c.icon : undefined);

/** Menu entry for a connector: the wallet's own icon when it has one, else a generic glyph. */
export const connectorItem = (
  c: Connector,
  onClick: () => void,
  label = c.name,
): WalletMenuItem => ({
  key: c.uid,
  label,
  icon: connectorIcon(c),
  lucide: connectorIcon(c) ? undefined : c.id === PRIVY_CONNECTOR_ID ? "mail" : "wallet",
  onClick,
});
