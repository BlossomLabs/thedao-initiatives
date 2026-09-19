import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { cn } from "~/lib/utils";

const ConnectButton = lazy(() => import("~/components/wallet/ConnectButton"));

// Figma: 12px 32px bar, Inter Tight 14px links 22px apart, active link green with a 2px underline.
const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    "relative font-inter-tight text-[14px] no-underline hover:no-underline hover:text-dao-green",
    isActive
      ? "text-dao-green after:absolute after:left-0 after:right-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-dao-green"
      : "text-white/65",
  );

// The same links as menu rows on phones (the wallet menu's row style).
const menuLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center rounded-[9px] px-3 py-2.5 font-inter-tight text-[14px] no-underline hover:no-underline hover:bg-[rgba(92,183,90,.08)] hover:text-dao-green",
    isActive ? "text-dao-green" : "text-soft",
  );

const LINKS = [
  { to: "/", label: "Initiatives", end: true },
  { to: "/submit", label: "Suggest an initiative" },
];

const Fallback = () => (
  <button type="button" className="btn btn-wallet" disabled>
    Connect wallet
  </button>
);

export default function TopBar({ staticShell }: { staticShell?: boolean }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close on navigation, on Escape, and on a tap anywhere else.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cls = (active: typeof link) => (staticShell ? active({ isActive: false }) : active);

  return (
    <header className="sticky top-0 z-50 border-b border-white/[.07] bg-[rgba(44,94,134,.5)] px-8 py-3 backdrop-blur-[20px] max-[760px]:px-3.5 max-[760px]:py-2.5">
      <div className="flex items-center justify-between gap-4 max-[760px]:gap-2.5">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 font-inter-tight text-[17px] font-light text-white no-underline hover:no-underline"
        >
          <img
            src="/dao-logo.svg"
            alt="Đ"
            width={22}
            height={22}
            className="size-[22px] flex-none"
          />
          <span className="whitespace-nowrap">
            <b className="font-bold">TheDAO</b>{" "}
            <span className="max-[640px]:hidden">Security Fund</span>
          </span>
        </Link>
        <div className="flex items-center gap-[22px] max-[760px]:gap-2.5">
          <nav className="flex items-center gap-[22px] max-[760px]:hidden" aria-label="Site">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={cls(link)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          {staticShell ? <Fallback /> : (
            <Suspense fallback={<Fallback />}>
              <ConnectButton />
            </Suspense>
          )}
          <button
            ref={toggleRef}
            type="button"
            className="btn btn-wallet hidden w-[38px] px-0 max-[760px]:inline-flex"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          ref={menuRef}
          id="site-menu"
          aria-label="Site"
          className="absolute inset-x-3.5 top-full mt-2 hidden flex-col rounded-[14px] border border-edge2 bg-panel p-1.5 shadow-menu max-[760px]:flex"
        >
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={cls(menuLink)}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
