import { lazy, Suspense } from "react";
import { Link, NavLink } from "react-router";
import { TRANSPARENCY_URL } from "~/data/site";
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

const Fallback = () => (
  <button type="button" className="btn btn-wallet" disabled>
    Connect wallet
  </button>
);

export default function TopBar({ staticShell }: { staticShell?: boolean }) {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-white/[.07] bg-[rgba(44,94,134,.5)] px-8 py-3 backdrop-blur-[20px] max-[760px]:flex-wrap max-[760px]:gap-x-3.5 max-[760px]:gap-y-2 max-[760px]:px-3.5 max-[760px]:py-2.5">
      <Link
        to="/"
        className="flex items-center gap-2.5 font-inter-tight text-[17px] font-light text-white no-underline hover:no-underline"
      >
        <img src="/dao-logo.svg" alt="Đ" width={22} height={22} className="size-[22px]" />
        <span className="max-[760px]:hidden">
          <b className="font-bold">TheDAO</b> Security Fund
        </span>
      </Link>
      <nav className="flex items-center gap-[22px] max-[760px]:flex-wrap max-[760px]:gap-3">
        <NavLink to="/" end className={staticShell ? link({ isActive: false }) : link}>
          Initiatives
        </NavLink>
        <a
          href={TRANSPARENCY_URL}
          target="_blank"
          rel="noopener"
          className={link({ isActive: false })}
        >
          Transparency
        </a>
        <NavLink
          to="/submit"
          className={({ isActive }) =>
            cn(link({ isActive: isActive && !staticShell }), "text-dao-green")}
        >
          Suggest an initiative
        </NavLink>
        {staticShell ? <Fallback /> : (
          <Suspense fallback={<Fallback />}>
            <ConnectButton />
          </Suspense>
        )}
      </nav>
    </header>
  );
}
