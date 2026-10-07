import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import { Providers } from "~/context/providers";
import TopBar from "~/components/layout/TopBar";
import Footer from "~/components/layout/Footer";
import SupportWidget from "~/components/layout/SupportWidget";
import MaintenanceBanner from "~/components/layout/MaintenanceBanner";
import AppUpgrade from "~/components/layout/AppUpgrade";
import ShellSkeleton, { SHELL_SCRIPT } from "~/components/layout/ShellSkeleton";
import { EARLY_FETCH_SCRIPT } from "~/lib/early-fetch";
import "./app.css";

// Fonts as a <link> rather than an @import inside app.css: the browser fetches
// them in parallel with the stylesheet instead of after it.
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600&family=Roboto+Mono:wght@400;500;600&display=swap";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: FONTS_URL },
  { rel: "icon", href: "/dao-logo.svg" },
  { rel: "apple-touch-icon", href: "/dao-logo.svg" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#2c5e86" />
        {
          /* Critical CSS: paint the brand background before any stylesheet
            arrives, and keep the body invisible until app.css applies (it
            ends with `body{visibility:visible}`). The script is a safety net
            so a failed stylesheet fetch still shows the page. */
        }
        <style
          dangerouslySetInnerHTML={{
            __html:
              "html{color-scheme:dark;background:#2c5e86 linear-gradient(142.716deg,#2c5e86 31.46%,#1f435f 90.4%) fixed no-repeat;color:#fff}" +
              "body{margin:0;visibility:hidden}",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: "setTimeout(function(){document.body.style.visibility='visible'},4000);" +
              SHELL_SCRIPT + ";" + EARLY_FETCH_SCRIPT,
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Column that fills the viewport so the footer never rides up under the top bar. */
function Shell(
  { children, staticShell, banner }: {
    children: React.ReactNode;
    staticShell?: boolean;
    /** Needs the query provider, so the static shell renders none. */
    banner?: React.ReactNode;
  },
) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar staticShell={staticShell} />
      {banner}
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <Providers>
      <Shell banner={<MaintenanceBanner />}>
        <Outlet />
      </Shell>
      <SupportWidget />
      <AppUpgrade />
    </Providers>
  );
}

/**
 * Prerendered SPA shell for non-prerendered URLs (initiative and admin
 * pages): no wallet/session providers (browser-only), static top bar, and a
 * skeleton in the page area so a direct hit does not start with the footer.
 * The skeleton's shape follows the URL (SHELL_SCRIPT), so the route's own
 * loading state continues it instead of replacing it.
 */
export function HydrateFallback() {
  return (
    <Shell staticShell>
      <ShellSkeleton />
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details = error.status === 404
      ? "The requested page could not be found."
      : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  // The static shell needs no providers, so it is safe here even when the
  // error came from one of them: the page keeps its top bar and footer.
  return (
    <Shell staticShell>
      <main className="mx-auto flex min-h-[60vh] max-w-[672px] flex-col items-center justify-center px-6 text-center animate-in fade-in duration-300">
        <h1 className="font-inter-tight text-[40px] font-medium tracking-[-.02em]">{message}</h1>
        <p className="mt-2 text-muted">{details}</p>
        <a href="/" className="btn mt-6">Back to the board</a>
        {stack && (
          <pre className="mt-6 w-full overflow-x-auto rounded-xl bg-black/25 p-4 text-left text-[12px]">
            <code>{stack}</code>
          </pre>
        )}
      </main>
    </Shell>
  );
}
