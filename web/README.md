# TheDAO Security Fund — web

React Router v7 SPA for the RFP board, built and served with Deno. The design
is the Figma file "TheDAO Sites" (board + Suggest an initiative), expressed as
Tailwind v4 tokens in `app/app.css`. Data comes from the API in `api/` (Deno + Hono + KV, see
`api/README.md`), which this package also hosts: `server.ts` serves the API under `/api` and the
built SPA for everything else, from one Deno Deploy app.

## Run it

    deno i                      # install deps
    cp .env.example .env        # web + api variables in one file
    deno task dev:api           # API on http://localhost:8000
    deno task dev               # http://localhost:5173, proxies /api to the API

    deno task typecheck         # react-router typegen + tsc
    deno task test              # vitest (jsdom)
    deno task test:api          # deno test (in-memory KV)
    deno task lint
    deno task build             # static build + prerender into build/client
    deno task start             # the deployed server: API + build/client on :8000

The web app calls the API on its own origin. Set `VITE_API_URL` only to point a build at a
remote API.

## Routes

- `/` board (hero total, AI search when enabled, initiative cards with inline
  donate, suggest card, pledge band)
- `/initiative/:slug` (funding, summary, markdown details, comments, backers,
  donations, donate/discuss/back/next side cards); `?rev=N` shows an older revision of the
  text, rendered or as word-level changes against the one before; `/rfp/:slug` redirects
- `/initiative/:slug/edit` (proposer or admin, SIWE): title, summary and details only; each
  save is a new public revision that goes live at once
- `/submit`, `/submit/thanks`
- `/donation-terms` (content/donation-terms.md, bundled at build time by `app/data/terms.ts`;
  the donate widget's terms gate links here and logs acceptances by its `version:` line)
- `/admin` (SIWE-gated), `/admin/dashboard` (incl. "Sync content files": pick the repo's
  `content` folder in the browser, no private key needed), `/admin/initiatives/:id`,
  `/admin/leads` (private funder leads + CSV)

`/`, `/submit`, `/submit/thanks`, `/donation-terms` and `/admin` are prerendered; everything else
is served from the SPA fallback by `server.ts`. `/api/*` and `/healthz` go to the Hono app.

## Wallet and sign-in

wagmi + viem: injected wallets (EIP-6963), WalletConnect when
`VITE_WALLETCONNECT_PROJECT_ID` is set, and "Email" when `VITE_PRIVY_APP_ID` is set.
Sign-In with Ethereum happens only when an action needs it (vote, reply, name, admin):
nonce → `createSiweMessage` → `personal_sign` → bearer token in `localStorage`
(`thedao:session`). See `app/context/session.tsx`.

Email sign-in is [Privy](https://docs.privy.io) used headless: our own dialog
(`app/components/wallet/EmailSignInDialog.tsx`) sends and checks the one-time code, Privy
creates an embedded wallet (a plain EOA) for the account, and `app/lib/privy.ts` exposes that
wallet to wagmi as the `privy` connector, so SIWE, donations and votes work unchanged and the
API never learns about Privy. Privy's wallet modals are disabled; the site's buttons are the
confirmation step. Signing out of the site also logs out of Privy. The SDK (~450 KB gzipped)
lives in its own chunk (`app/context/privy.tsx`) that only loads when someone picks Email or
returns with an email session, so wallet users never download it.

## Deploy (Deno Deploy)

| Setting | Value |
|---|---|
| Root directory | `web` |
| Install command | `deno i` |
| Build command | `deno task build` |
| Entrypoint | `server.ts` |
| Env | everything in `.env.example` except `KV_PATH` and the dev-only keys |

`WEB_ORIGIN` lists the browser origins allowed to call the API (comma-separated; the custom domain
goes here). Requests served on a platform host (`*.deno.net`, `*.deno.dev`, or whatever
`SELF_HOST_SUFFIXES` names) are additionally accepted as their own origin, for both the origin guard
and the SIWE domain, so production and branch preview URLs work without listing each one. Set `SITE_USERNAME` and `SITE_PASSWORD` to keep the site in private preview
behind HTTP Basic Auth; see `api/README.md`. Set `DB_PREFIX` when two deployments share one KV
database (keys are namespaced under it; changing it means starting from an empty database).
