# TheDAO Security Fund — initiatives board

[![CI](https://github.com/BlossomLabs/thedao-initiatives/actions/workflows/ci.yml/badge.svg)](https://github.com/BlossomLabs/thedao-initiatives/actions/workflows/ci.yml)

Public board of Ethereum-security initiatives (RFPs, grants and top-ups) at
https://initiatives.thedao.fund. Sponsors pledge, anyone donates on-chain, TheDAO completes the
funding gap.

React Router v7 SPA built and served with Deno. The design is the Figma file "TheDAO Sites" (board +
Suggest an initiative), expressed as Tailwind v4 tokens in `app/app.css`. Data comes from the API in
`api/` (Deno + Hono + KV, see `api/README.md`), hosted by the same package: `server.ts` starts one
Hono app serving the API under `/api` and the built SPA, from one Deno Deploy app. The initiative texts,
the process rules and the donation terms are files under `content/`; the proposer's AI guide is
`public/submit.md` (the drafting guide; `/llms.txt` is now the generated index of approved initiatives). The Flask MVP this replaced is described in `docs/v1-to-v2.md`.

AI search uses TypeSafe Jev to score every approved initiative against the donor's query.
With Jev enabled, search runs after a 500 ms pause in typing (at least three characters);
the LLM mode searches on Enter or Ask AI. The board orders all initiatives by descending score; the first three visible scored results receive an **AI pick** label with their score as a percentage. Filters still apply, and a
manual sort clears the AI order. Set `TYPESAFE_API_KEY` to enable search; `TYPESAFE_MODEL`
defaults to the pinned `jev-1.13.0`. Set `TYPESAFE_ENABLED=false` to use the existing
`AI_SEARCH_*` LLM for search instead, with the same full ordering and top-three labels;
the LLM must supply a valid score for every proposal. Category suggestions and comment moderation continue
using the separate OpenAI-compatible `AI_SEARCH_*` settings. Search scores are cached for ten
minutes, keyed by the query, model, and scored proposal text.

## How money flows

- Every approved initiative has its **own 3-of-5 Gnosis Safe**, deployed before approval: the
  Approve button first asks the admin's wallet for the deploy transaction (canonical Safe v1.4.1
  factory; the server holds no keys and no funds), the server verifies owners, threshold, singleton
  and fallback handler at the Safe's CREATE2 address, and only then does the initiative go live. The
  server never approves an initiative without a verified Safe.
- Donations are ERC-20 transfers (or plain ETH sends) straight from the donor's wallet to the
  initiative's Safe. Accepted tokens: USDC, USDT, DAI, USDS, crvUSD, BOLD, fxUSD, EURC, ZCHF; the
  non-USD ones are priced by Chainlink feeds with staleness checks.
- "Raised" uses the Safe's saved balance, priced with Chainlink. Pages show that snapshot first,
  then refresh stale balances in the background, at most once per Safe every two minutes across
  server instances. A newly confirmed wallet donation makes its Safe eligible sooner. The donor
  ledger follows the same request-driven flow: show saved donations immediately, display an
  updating indicator when stale, then show the refreshed rows after they reach KV. Its cache lasts
  ten minutes by default (`SAFE_SYNC_TTL_SECS`). A daily fallback at 03:00 UTC refreshes stale
  balances and donation rows for approved initiatives only when `DENO_TIMELINE` is `production`.
  It reuses the same KV leases and skips fresh data. Branches, previews and local runs do no
  scheduled refresh work. There is no startup chain check.
  New transactions are re-verified over RPC, `MIN_CONFIRMATIONS` blocks deep, before they are
  credited. Amounts come from the chain, never from the browser.

## Run it

    deno i                      # install deps
    cp .env.example .env        # web + api variables in one file
    deno task dev               # web on http://localhost:5173 + API on :8000, together
    deno task dev:web           # just the web app, proxies /api to the API
    deno task dev:api           # just the API on http://localhost:8000

    deno task typecheck         # react-router typegen + tsc
    deno task test              # vitest (jsdom)
    deno task test:api          # deno test (in-memory KV)
    deno task check:api         # type-check api + server + scripts
    deno task lint
    deno task build             # static build + prerender into build/client
    deno task start             # the deployed server: API + build/client on :8000

The web app calls the API on its own origin. Set `VITE_API_URL` only to point a build at a remote
API.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, both test suites and the build on every push
and pull request. Deno Deploy builds and deploys `main` itself; there is no deploy job.

## Routes

- `/` board (hero total, AI search when enabled, initiative cards with inline donate, suggest card,
  pledge band)
- `/initiative/:slug` (funding, summary, markdown details, comments, backers, donations,
  donate/discuss/back/next side cards); `?rev=N` shows an older revision of the text, rendered or as
  word-level changes against the one before; `/rfp/:slug` redirects
- `/initiative/:slug/edit` (proposer or admin, SIWE): the submit form on the stored row. Sections,
  milestones, links, title and summary are always editable and each save is a new public revision
  that goes live at once; while the initiative is pending the type, goal, duration, recipient, forum
  link and the private fields can change too (locked after approval for the proposer, never for an
  admin, who edits here under the same checks)
- `/submit`, `/submit/thanks`
- `/donation-terms` (the version in force of `content/donation-terms/<date>.md`, bundled at build
  time by `app/data/terms.ts`, with every earlier version listed; the donate widget's gate and the
  footer link here), `/donation-terms/v/:id` (one earlier version by its content hash)
- `/admin` (SIWE-gated dashboard, incl. "Sync content files": pick the repo's `content`
  folder in the browser, no private key needed), `/admin/initiatives/:id` (status, Safe, settings,
  pledges, donations, revisions; the text is edited at `/initiative/:slug/edit`), `/admin/leads` (private
  funder leads + CSV), `/admin/maintenance` (pause every write on the site, download the whole
  database as one JSON file, restore one while paused, see `api/README.md`)

`/`, `/submit`, `/submit/thanks`, `/donation-terms` and `/admin` are prerendered; everything else is
served from the SPA fallback by the same Hono app. API, health and Markdown routes are registered
before static files and the SPA fallback; unknown API URLs remain JSON 404s.

`server.ts` only boots the app and registers the daily job. `api/app.ts` owns routing, shared
security headers and the preview lock; `api/site.ts` serves the built files with their existing
cache rules and staging-origin rewriting. API sessions, auditing, CORS and request guards run only
on API, health and Markdown routes. HTML keeps its inline-script hashes and `CSP_ENFORCE` behavior;
API responses keep their resource-blocking CSP. Shared headers also cover preview-lock denials.

### Publishing a new version of the donation terms

Every version is a file in `content/donation-terms/`, named by its effective date, and git history is
the audit trail. The API recognizes those deployed documents and records browser checkbox acceptance;
there is no admin publishing action.

1. Copy the current file to `content/donation-terms/<YYYY-MM-DD>.md` and set its first line to
   `version: <YYYY-MM-DD>` (the same date as the file name).
2. For a material change add a second header line, `material: true`. It shows a notice on the terms
   page and under the donate widget for 30 days from the effective date. The flag is not part of
   the version id, so it can be corrected later without minting a new version.
3. Edit the body, then run `deno task test` (it validates the header, the date and the file name).
4. Merge and deploy on the effective date: the highest date is the version in force as soon as it
   ships. Deploy the content directory with the API and restart it to refresh the recognized versions.
   Never edit or delete a published file.

A version's id is the SHA-256 of `<effective date>\n<body>`. The widget requires a checkbox and
records its version on the server before sending or showing the exchange address. Transaction
matching provides browser correlation, not authenticated donor consent (see `api/README.md`).

## Wallet and sign-in

The header and inline connect buttons share a lazy-loaded wallet chooser. Installed browser wallets
use wagmi's injected connector; mobile wallets share one WalletConnect connector with telemetry and
the bundled Reown modal disabled. The chooser serves a searchable, alphabetically sorted directory
from `public/wallets.json`, so browsing wallets does not contact an external wallet directory or load
remote logos. Wallet rows use local monograms. Selecting an app follows its registered deep link;
QR code and copy URI remain available for other compatible wallets.

Pairing starts when the user selects "Mobile wallets / QR code". App links become available once the
URI is ready, so navigation happens directly on the user's tap (including on iOS). Closing the dialog
keeps that request alive; either connect button reopens it. Selecting another app reuses the same
pairing URI. The chooser stays available through the SIWE signature step and offers an "Open wallet"
link to return to the selected app. Rejecting or expiring a request clears the URI and permits retry.
The QR renderer is `qrcode.react` (no runtime dependencies); no per-wallet SDK is added.
The `package.json` override for `x402` reuses wagmi 3, removing the older wagmi 2 connector tree that
pulled in MetaMask's SDK, analytics, communication layer, and install modal through Privy. Privy uses
`x402/client`, which does not import wagmi; the separate `x402/paywall` entry point is unused here.
The lockfile contains no `@metamask/*` packages. Recheck this when updating Privy or x402, especially
before adding paywall features. Disabling WalletConnect telemetry does not disable telemetry in
other SDKs.

Refresh the directory explicitly with `deno task sync-wallets` (requires the existing
`VITE_WALLETCONNECT_PROJECT_ID` in `.env`). The script downloads Ethereum-mainnet, mobile,
WalletConnect-v2 listings, validates links, strips any stale pairing URI, and writes the snapshot.
Review that diff before shipping it. Wallets with missing or ambiguous links remain searchable and
use QR/copy. A registry entry is not a guarantee that a particular app/version handles its link;
device testing should cover iOS/Android app launch, return, sign-in, rejection, and reconnect.

wagmi + viem: injected wallets (EIP-6963), WalletConnect when `VITE_WALLETCONNECT_PROJECT_ID` is
set, and "Email" when `VITE_PRIVY_APP_ID` is set. Sign-In with Ethereum happens only when an action
needs it (vote, reply, name, admin): nonce → `createSiweMessage` → `personal_sign` →
`POST /api/auth/verify` with `cookie: true`, which answers with the session in an HttpOnly cookie
(`__Host-session` over https, `session` on plain-http dev; `SameSite=Lax`, `Path=/`) and no token
in the body, so no script on the page can read it. `localStorage` (`thedao:session`) only keeps
`{address, isAdmin, expiresAt}` to know who is signed in, and that record is checked against
`/api/auth/me` once per load and dropped on a 401. Every API call sends the cookie
(`credentials: "include"`); state-changing calls are also gated by the Origin allow-list. Scripts
keep the bearer instead (`api/README.md`). See `app/context/session.tsx`.

Email sign-in is [Privy](https://docs.privy.io) used headless: our own dialog
(`app/components/wallet/EmailSignInDialog.tsx`) sends and checks the one-time code, Privy creates an
embedded wallet (a plain EOA) for the account, and `app/lib/privy.ts` exposes that wallet to wagmi
as the `privy` connector, so SIWE, donations and votes work unchanged and the API never learns about
Privy. Privy's wallet modals are disabled; the site's buttons are the confirmation step. Signing out
of the site also logs out of Privy. The SDK (~450 KB gzipped) lives in its own chunk
(`app/context/privy.tsx`) that only loads when someone picks Email or returns with an email session,
so wallet users never download it.

## Deploy (Deno Deploy)

| Setting         | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Root directory  | `/`                                                                 |
| Install command | `deno i`                                                            |
| Build command   | `deno task build`                                                   |
| Entrypoint      | `server.ts`                                                         |
| Env             | everything in `.env.example` except `KV_PATH` and the dev-only keys |

The browser origins allowed to call the API default to `VITE_SITE_URL`'s origin, so a deployment on
one custom domain needs nothing more; `WEB_ORIGIN` (comma-separated) overrides that list for local
dev or a second domain. Requests served on a platform host (`*.deno.net`, `*.deno.dev`, or whatever
`SELF_HOST_SUFFIXES` names) are additionally accepted as their own origin, for both the origin guard
and the SIWE domain, so production and branch preview URLs work without listing each one. Set
`SITE_USERNAME` and `SITE_PASSWORD` to keep the site in private preview behind HTTP Basic Auth; see
`api/README.md`. Set `DB_PREFIX` when two deployments share one KV database (keys are namespaced
under it; changing it means starting from an empty database).
