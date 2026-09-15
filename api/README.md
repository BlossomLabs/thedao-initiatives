# TheDAO Security Fund — API

JSON API for the initiatives board, on Deno + Hono + Deno KV. It replaced the Flask app that lived
at the repository root until 2026-09-15 (see `docs/v1-to-v2.md`). `../server.ts` serves it under
`/api` next to the built SPA, and `../deno.json` holds the tasks and imports.

## Run it (from the repository root)

    cp .env.example .env      # fill in what you have
    deno task dev:api         # http://localhost:8000 on its own, local KV in ../.kv

    deno task test:api        # in-memory KV, no network
    deno task check:api       # type-check api + server + scripts
    deno task lint && deno task fmt

## How it differs from the Python MVP (v1, removed on 2026-09-15)

- **Sign-In with Ethereum** (EIP-4361) is the only auth. EOA signatures are recovered locally; when
  that fails the message address is asked via EIP-1271 (one `eth_call`), so Safes and smart wallets
  can sign in too. `GET /api/auth/nonce`, sign the message, `POST /api/auth/verify` → bearer token.
  One signature per session instead of one per comment/vote/nickname. A session whose address is in
  `ADMIN_ADDRESSES` is an admin session. No password. The only cookie is the private-preview unlock
  (below).
- **"Raised" is the Safe's balance.** `services/funding.ts` reads every accepted token's `balanceOf`
  and the ETH balance of an initiative's Safe over RPC, prices them with the Chainlink feeds, adds
  the admin-entered `paidOutUsd`, and caches the result 15 s per Safe. The number moves as soon as a
  transfer is mined; when the RPC read fails the ledger's confirmed total is used and the summary
  says `live: false`. Design: `docs/balance-funding-design-2026-09-12.md`.
- **The ledger is discovered, not scanned.** Donor rows come from the Safe Transaction Service: a
  `Deno.cron` (default every 10 min) makes one authenticated request per Safe, re-verifies each new
  tx over RPC, and writes the row to KV. Nothing on the page waits for it; the initiative page shows
  when it last ran (`ledger.checkedAt`) and the interval derived from `SAFE_SYNC_CRON`. Set
  `SAFE_API_KEY`.
- **Content sync is push-based.** `deno task sync-content` reads `../../content/rfps/*.md` and POSTs
  them to `/api/admin/sync-content`. Files own the words and the goal; the admin panel owns status,
  Safes and money. Run the sync after every deploy that changes content. Besides the keys in
  `content/rfps/README.md` (`duration`, `topup`, `reviewer`), the web parser reads two web-only keys
  on grants: `recipient` (the team the grant goes to) and `recipient_url` (an https link). **Content
  files must be structured**: the body is split with the guide's headings (`## Why this
  matters`,
  `## In scope`, `## Out of scope`, …, `## Milestones` with `### Name - $amount
  (adoption)` rows
  and one `- criterion` per line, optionally `## Links`). A file is synced only when every section
  of its type is present, every milestone has an amount and a criterion, the amounts sum to the
  goal, no other-type section and no text outside a known heading remain. Any other file is skipped
  and its sync error lists what is missing
  (`not structured: missing: Out of
  scope; unsorted text: …`); the row it would have updated is
  left as it was.
- **The process rules are not in the API.** `content/boilerplate/{rfp,grant,topup}.md` are bundled
  at build time (`app/data/rules.ts`) and render as a panel on every initiative page; the kind is
  picked from the initiative's type and top-up flag.
- **The donation terms are not in the API.** Every version is a file in `content/donation-terms/`,
  bundled into the site at build time (`app/data/terms.ts`, prerendered at `/donation-terms`); the
  version id is the SHA-256 of the effective date plus the text. What the API keeps is one
  **acceptance record per donation**: `POST /api/donate/confirm` takes an optional
  `terms: { version, acceptedAt, address? }` block (the id the widget displayed, the ISO time of the
  checkbox tick, the wallet connected at the time) and writes `["terms_accept", <txHash>]` before
  consulting the chain. First write wins and the record is never changed; it joins the donation row
  by tx hash, and a tx that never confirms simply leaves an orphan record. A malformed block is a
  400 rather than a dropped record. Donations found by the Safe indexer (exchange withdrawals, card
  on-ramps) have no record. Rows written by the old `POST /api/terms/accept` (3-part keys) are left
  in place.
- **Uploads go to Pinata** (backer logos, profile pictures); only the CID is stored. Set
  `PINATA_JWT`; until then uploads answer 503.
- **Initiatives are structured** (submission redesign, Sep 2026): the text of a row is `sections`
  (one markdown answer per section key of its type, see `shared/draft/sections.ts`), `milestones`
  (`{name, amount, adoption, done, link, month, criteria[]}`) and `links` (https only). The JSON
  carries them plus `structured: true`. `details` is legacy-only: rows written before the redesign
  keep their single markdown body (`structured: false`) until someone re-submits them as sections; a
  row is one or the other, never both. The rules that check a body (`shared/draft/checks.ts`) are
  the same on the form and here; failures come back as
  `{error, findings: {errors: [{field, msg, kind}], warnings: [{field, msg}]}}` with the form's
  field ids.
- **Text is revisioned.** Every change to title, summary, sections, milestones, links or the legacy
  details (the proposer's edit page, the admin editor, content sync) appends an immutable revision
  under `["revision", rfpId, n]`; the initiative row carries the current number. A revision carries
  the structured fields too. Revisions are public; admins can archive a superseded one (hidden from
  the public history, never the current one). Rows written before revisions existed get their text
  snapshotted as revision 1 on their first edit.
- Ids are ULID strings. Rate limits live in KV so they hold across isolates.

## Reusing proposal URLs

A submission can take its title-derived slug from an archived proposal. The archived row moves to
`<slug>-archived-<lowercase-id>` (with an additional numeric suffix if needed), retaining its ID,
history, funds and Safe. The transfer and creation commit atomically. The replacement starts
pending, so its clean URL is private until approval. Archived text may also be resubmitted; pending,
approved and rejected proposals still block duplicate content. Other name collisions retain the
normal suffix allocation. Existing numbered proposals are not renamed automatically.

Unarchiving recalculates the slug from the current title: the clean slug if available, otherwise
`-2`, `-3`, etc. It never displaces another proposal. Generated archive URLs remain reserved aliases
to their original ID, including after unarchiving and another archival. Rejecting a replacement does
not return its clean URL to the original proposal.

Content sync and SQLite imports resolve filenames through a persistent source-slug-to-ID index,
initialized lazily for older rows. Reusing a public URL cannot retarget the source file or its
backers. Safe deployment uses an immutable ID-based key for new proposals; existing and imported
proposals keep their legacy salt input, frozen before their URL changes. These metadata fields are
internal and cannot be edited through proposal APIs. No bulk migration is required.

Slug-addressed edits, comment posts and donation confirmations accept `initiativeId`, the ID from
the displayed initiative. A mismatched ID returns 409 with a refresh message. Missing IDs remain
accepted for URLs that have never been released or reused; reused URLs require the ID. Admin
mutations and Safe deployment requests must use the permanent ID for reused URLs. The admin editor
switches to its ID route after loading, and the web client includes IDs in writes.

## Endpoints

Public: `GET /healthz`, `GET /api/board`, `GET /api/initiatives/:slug` (a pending one only for its
proposer and admins), `GET /api/initiatives/:slug/revisions/:n`, `POST /api/initiatives` (submit,
always pending: the form as JSON, backers become `pledged` rows), `GET /api/donate/params`,
`POST /api/donate/confirm`, `GET /api/donate/status/:txHash`, `GET /api/ens-name/:addr`,
`GET /api/nickname/:addr`, `POST /api/ai-search`, `GET /api/initiatives/:slug/comments`,
`POST /api/initiatives/:slug/comments`, `GET /api/comments/mine?tokens=`,
`POST /api/comments/:id/report`.

Signed in: `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/logout-all`,
`POST /api/nickname`, `POST /api/pfp`, `POST /api/pfp/upload`, `POST /api/comments/:id/vote`,
`POST /api/comments/:id/reply` (role-gated), `POST /api/uploads/logo` (multipart `image`, a backer
logo pinned before submitting; returns `{cid, logoUrl}`, the CID is only accepted on a submission
from the same wallet within a day), `POST /api/initiatives/:slug/revisions` (proposer or admin:
title, summary, sections, milestones, links; a legacy row also takes `details`),
`PATCH /api/initiatives/:slug` (proposer while pending, admin always: type, topup, goal,
durationMonths, recipientTeam, recipientUrl, milestoneReviewer, discourseUrl, funders, contact;
after approval a proposer gets 403).

Admin (`/api/admin/...`): `GET dashboard`, `GET|PATCH initiatives/:id`,
`POST initiatives/:id/status`, `POST initiatives/:id/revisions/:n` (archive / unarchive),
`POST|PATCH|DELETE initiatives/:id/pledges[/:pid]`, `POST initiatives/:id/donations/recheck`,
`POST initiatives/:id/sync-donations`, `GET initiatives/:id/safe-deploy-params`,
`POST initiatives/:id/safe-confirm`, `POST comments/:id/:action`, `POST sync-content`.

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

`domain` must be in `SIWE_DOMAINS` and `uri`'s origin in the allowed origins (`WEB_ORIGIN`, or
`VITE_SITE_URL`'s origin when that is unset).

## Deploy (Deno Deploy)

One Deno Deploy app for API and site: root directory `/`, entrypoint `server.ts` (the table in the
root README). Set the variables from `.env.example` (no `KV_PATH`). KV and cron are provided by the
platform; each timeline gets its own database. If two deployments must
share one KV database, give each its own `DB_PREFIX`: every key is stored under that first part, so
the two never see each other's rows (changing it on a live deployment starts from empty).

## Scripts

- `ADMIN_PRIVATE_KEY=0x… deno task login` — prints a bearer token (dev wallet whose address is in
  `ADMIN_ADDRESSES`).
- `ADMIN_TOKEN=… deno task sync-content` — pushes the content files.
