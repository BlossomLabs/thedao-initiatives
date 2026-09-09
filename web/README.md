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
  donations, donate/discuss/back/next side cards); `/rfp/:slug` redirects
- `/submit`, `/submit/thanks`
- `/donation-terms` (content/donation-terms.md, synced into the API; the donate widget's
  terms gate links here)
- `/admin` (SIWE-gated), `/admin/dashboard`, `/admin/initiatives/:id`, `/admin/leads`
  (private funder leads + CSV)

`/`, `/submit`, `/submit/thanks`, `/donation-terms` and `/admin` are prerendered; everything else
is served from the SPA fallback by `server.ts`. `/api/*` and `/healthz` go to the Hono app.

## Wallet and sign-in

wagmi + viem: injected wallets (EIP-6963) and WalletConnect when
`VITE_WALLETCONNECT_PROJECT_ID` is set. Sign-In with Ethereum happens only when
an action needs it (vote, reply, name, admin): nonce → `createSiweMessage` →
`personal_sign` → bearer token in `localStorage` (`thedao:session`). See
`app/context/session.tsx`.

## Deploy (Deno Deploy)

| Setting | Value |
|---|---|
| Root directory | `web` |
| Install command | `deno i` |
| Build command | `deno task build` |
| Entrypoint | `server.ts` |
| Env | everything in `.env.example` except `KV_PATH` and the dev-only keys |

`WEB_ORIGIN` must be this site's origin (CORS is moot on one origin, but the SIWE domain is
derived from it). Set `SITE_USERNAME` and `SITE_PASSWORD` to keep the site in private preview
behind HTTP Basic Auth; see `api/README.md`.
