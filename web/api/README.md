# TheDAO Security Fund — API

JSON API for the RFP board, rebuilt on Deno + Hono + Deno KV. It replaces the Flask app at the repo
root. It lives inside the web package: `../server.ts` serves it under `/api` next to the built SPA,
and `../deno.json` holds the tasks and imports.

## Run it (from `web/`)

    cp .env.example .env      # fill in what you have
    deno task dev:api         # http://localhost:8000 on its own, local KV in ../.kv

    deno task test:api        # in-memory KV, no network
    deno task check:api       # type-check api + server + scripts
    deno task lint && deno task fmt

## How it differs from the Python MVP

- **Sign-In with Ethereum** (EIP-4361) is the only auth. `GET /api/auth/nonce`, sign the message,
  `POST /api/auth/verify` → bearer token. One signature per session instead of one per
  comment/vote/nickname. A session whose address is in `ADMIN_ADDRESSES` is an admin session. No
  password. The only cookie is the private-preview unlock (below).
- **No background scanner.** Donations are discovered through the Safe Transaction Service: a
  `Deno.cron` (default every 10 min) makes one authenticated request per Safe, re-verifies each new
  tx over RPC, and writes the result to KV. Page reads never call Safe. Set `SAFE_API_KEY`.
- **Content sync is push-based.** `deno task sync-content` reads `../../content/rfps/*.md` plus
  `../../content/donation-terms.md` and POSTs them to `/api/admin/sync-content`. Files own the words
  and the goal; the admin panel owns status, Safes and money. The terms file's first line
  `version: YYYY-MM-DD` is the donate widget's gate version: `GET /api/terms` serves it,
  `POST /api/terms/accept` logs acceptances (anonymous, or once per wallet and version) to KV. Run
  the sync after every deploy that changes content.
- **Uploads go to Pinata** (backer logos, profile pictures); only the CID is stored. Set
  `PINATA_JWT`; until then uploads answer 503.
- Markdown (`details`) is stored and returned raw; the frontend renders it.
- Ids are ULID strings. Rate limits live in KV so they hold across isolates.

## Endpoints

Public: `GET /healthz`, `GET /api/board`, `GET /api/initiatives/:slug`, `POST /api/initiatives`
(submit, always pending), `GET /api/donate/params`, `POST /api/donate/confirm`,
`GET /api/donate/status/:txHash`, `GET /api/ens-name/:addr`, `GET /api/nickname/:addr`,
`POST /api/ai-search`, `GET /api/initiatives/:slug/comments`,
`POST /api/initiatives/:slug/comments`, `GET /api/comments/mine?tokens=`,
`POST /api/comments/:id/report`.

Signed in: `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/logout-all`,
`POST /api/nickname`, `POST /api/pfp`, `POST /api/pfp/upload`, `POST /api/comments/:id/vote`,
`POST /api/comments/:id/reply` (role-gated).

Admin (`/api/admin/...`): `GET dashboard`, `GET|PATCH initiatives/:id`,
`POST initiatives/:id/status`, `POST|PATCH|DELETE initiatives/:id/pledges[/:pid]`,
`POST initiatives/:id/donations/recheck`, `POST initiatives/:id/sync-donations`,
`GET initiatives/:id/safe-deploy-params`, `POST initiatives/:id/safe-confirm`,
`POST comments/:id/:action`, `POST sync-content`.

All bodies and responses are JSON (`{error}` on failure). Private fields (`contact`, `funders`,
comment `email`) only appear in admin responses.

## SIWE from the frontend

```js
const { nonce } = await (await fetch(API + "/api/auth/nonce")).json();
const message = createSiweMessage({
  address,
  chainId: 1,
  domain: location.host,
  nonce,
  uri: location.origin,
  version: "1",
  statement: "Sign in to TheDAO Security Fund",
});
const signature = await walletClient.signMessage({ account: address, message });
const { token } = await (await fetch(API + "/api/auth/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, signature }),
})).json();
// then: Authorization: Bearer <token>
```

`domain` must be in `SIWE_DOMAINS` and `uri`'s origin in `WEB_ORIGIN`.

## Deploy (Deno Deploy)

App root `api/`, entrypoint `main.ts`. Set the variables from `.env.example` (no `KV_PATH`). KV and
cron are provided by the platform; each timeline gets its own database.

## Scripts

- `ADMIN_PRIVATE_KEY=0x… deno task login` — prints a bearer token (dev wallet whose address is in
  `ADMIN_ADDRESSES`).
- `ADMIN_TOKEN=… deno task sync-content` — pushes the content files.
- `deno task import-sqlite -- --db ../../rfps.db` — one-off import of the MVP database.
