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
import PageSkeleton from "~/components/layout/PageSkeleton";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
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
function Shell({ children, staticShell }: { children: React.ReactNode; staticShell?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar staticShell={staticShell} />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <Providers>
      <Shell>
        <Outlet />
      </Shell>
    </Providers>
  );
}

/**
 * Prerendered SPA shell for non-prerendered URLs (initiative pages): no
 * wallet/session providers (browser-only), static top bar, and the detail
 * skeleton in the page area so a direct hit does not start with the footer.
 */
export function HydrateFallback() {
  return (
    <Shell staticShell>
      <PageSkeleton />
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
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[672px] flex-col items-center justify-center px-6 text-center">
      <h1 className="font-inter-tight text-[40px] font-medium tracking-[-.02em]">{message}</h1>
      <p className="mt-2 text-muted">{details}</p>
      <a href="/" className="btn mt-6">Back to the board</a>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto rounded-xl bg-black/25 p-4 text-left text-[12px]">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
