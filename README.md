# TheDAO Security Fund — initiatives board

[![CI](https://github.com/BlossomLabs/thedao-rfps/actions/workflows/ci.yml/badge.svg)](https://github.com/BlossomLabs/thedao-rfps/actions/workflows/ci.yml)

Public board of Ethereum-security initiatives (RFPs, grants and top-ups) at
https://initiatives.thedao.fund. Sponsors pledge, anyone donates on-chain, TheDAO completes the
funding gap.

React Router v7 SPA built and served with Deno. The design is the Figma file "TheDAO Sites" (board +
Suggest an initiative), expressed as Tailwind v4 tokens in `app/app.css`. Data comes from the API in
`api/` (Deno + Hono + KV, see `api/README.md`), hosted by the same package: `server.ts` serves the API
under `/api` and the built SPA for everything else, from one Deno Deploy app. The initiative texts,
the process rules and the donation terms are files under `content/`; the proposer's AI guide is
`public/llms.txt`. The Flask MVP this replaced is described in `docs/v1-to-v2.md`.

## How money flows

- Every approved initiative has its **own 3-of-5 Gnosis Safe**, deployed before approval: the
  Approve button first asks the admin's wallet for the deploy transaction (canonical Safe v1.4.1
  factory; the server holds no keys and no funds), the server verifies owners, threshold, singleton
  and fallback handler at the Safe's CREATE2 address, and only then does the initiative go live. The
  server never approves an initiative without a verified Safe.
- Donations are ERC-20 transfers (or plain ETH sends) straight from the donor's wallet to the
  initiative's Safe. Accepted tokens: USDC, USDT, DAI, USDS, crvUSD, BOLD, fxUSD, EURC, ZCHF; the
  non-USD ones are priced by Chainlink feeds with staleness checks.
- "Raised" is the Safe's balance, read over RPC and priced with Chainlink, so it moves as soon as a
  transfer is mined. The donor ledger comes from the Safe Transaction Service on a `Deno.cron`
  schedule, and every new transaction is re-verified over RPC, `MIN_CONFIRMATIONS` blocks deep,
  before it is credited. Amounts come from the chain, never from the browser.

## Run it

    deno i                      # install deps
    cp .env.example .env        # web + api variables in one file
    deno task dev:api           # API on http://localhost:8000
    deno task dev               # http://localhost:5173, proxies /api to the API

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
  link and the private fields can change too (locked after approval, admins edit them under
  `/admin`)
- `/submit`, `/submit/thanks`
- `/donation-terms` (the version in force of `content/donation-terms/<date>.md`, bundled at build
  time by `app/data/terms.ts`, with every earlier version listed; the donate widget's gate and the
  footer link here), `/donation-terms/v/:id` (one earlier version by its content hash)
- `/admin` (SIWE-gated dashboard, incl. "Sync content files": pick the repo's `content`
  folder in the browser, no private key needed), `/admin/initiatives/:id`, `/admin/leads` (private
  funder leads + CSV)

`/`, `/submit`, `/submit/thanks`, `/donation-terms` and `/admin` are prerendered; everything else is
served from the SPA fallback by `server.ts`. `/api/*` and `/healthz` go to the Hono app.

### Publishing a new version of the donation terms

Every version is a file in `content/donation-terms/`, named by its effective date, and git history is
the audit trail. Nothing is stored in the API and there is no admin action: publishing is a merge.

1. Copy the current file to `content/donation-terms/<YYYY-MM-DD>.md` and set its first line to
   `version: <YYYY-MM-DD>` (the same date as the file name).
2. For a material change add a second header line, `material: true`. It shows a notice on the terms
   page and under the donate widget for 30 days from the effective date. The flag is not part of
   the version id, so it can be corrected later without minting a new version.
3. Edit the body, then run `deno task test` (it validates the header, the date and the file name).
4. Merge and deploy on the effective date: the highest date is the version in force as soon as it
   ships. Never edit or delete a published file.

A version's id is the SHA-256 of `<effective date>\n<body>`. The widget remembers acceptance per id,
so every new version asks donors to accept again, and each donation's acceptance record names the
id the donor saw (see `api/README.md`).

## Wallet and sign-in

wagmi + viem: injected wallets (EIP-6963), WalletConnect when `VITE_WALLETCONNECT_PROJECT_ID` is
set, and "Email" when `VITE_PRIVY_APP_ID` is set. Sign-In with Ethereum happens only when an action
needs it (vote, reply, name, admin): nonce → `createSiweMessage` → `personal_sign` → bearer token in
`localStorage` (`thedao:session`). See `app/context/session.tsx`.

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
