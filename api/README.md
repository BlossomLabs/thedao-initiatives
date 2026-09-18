# TheDAO Security Fund — API

JSON API for the initiatives board, on Deno + Hono + Deno KV. It replaced the Flask app that lived
at the repository root until 2026-09-15 (see `docs/v1-to-v2.md`). `../server.ts` starts a single
Hono app serving `/api` and the built SPA; `../deno.json` holds the tasks and imports. `app.ts`
applies shared headers and the preview lock once. API middleware is scoped to API, health and
Markdown routes, and `site.ts` handles static files and SPA fallbacks. `main.ts` starts the same app
without static files for API-only development.

## Run it (from the repository root)

    cp .env.example .env      # fill in what you have
    deno task dev:api         # http://localhost:8000 on its own, local KV in ../.kv

    deno task test:api        # in-memory KV, no network
    deno task check:api       # type-check api + server + scripts
    deno task lint && deno task fmt

## How it differs from the Python MVP (v1, removed on 2026-09-15)

- **Sign-In with Ethereum** (EIP-4361) is the only auth. EOA signatures are recovered locally; when
  that fails the message address is asked via EIP-1271 (one `eth_call`), so Safes and smart wallets
  can sign in too. `GET /api/auth/nonce`, sign the message, `POST /api/auth/verify` → a session
  token, either as an HttpOnly cookie (the browser sends `cookie: true`) or in the JSON body as a
  bearer (scripts). One signature per session instead of one per comment/vote/nickname. A session
  whose address is in `ADMIN_ADDRESSES` is an admin session. No password. The cookies are the
  session (`lib/session-cookie.ts`) and the private-preview unlock (below). `POST /api/auth/cookie`
  (bearer in, same session back as the cookie) migrates records stored before 2026-09-15; remove it,
  `app/lib/session-migration.ts` and its call in `app/context/session.tsx` a week after that deploy.
- **"Raised" is the Safe's balance.** `services/funding.ts` reads every accepted token's `balanceOf`
  and the ETH balance of an initiative's Safe over RPC, prices them with the Chainlink feeds, adds
  the admin-entered `paidOutUsd`, and saves balances in shared KV for two minutes per Safe. Normal
  board/initiative GETs return that snapshot without reading balances over RPC. When a summary's
  `refreshDue` is true, the browser paints it and fetches the same URL with `?refresh=1`; that
  request rechecks freshness, acquires a shared lease, and returns refreshed values for the existing
  number animation. A failed refresh keeps the old snapshot and waits 60 seconds before retrying.
  Before the first successful read, the ledger total is the fallback (`live: false`). Global UI
  reads `/api/board/settings` without subscribing to funding. Design:
  `docs/balance-funding-design-2026-09-12.md`.
- **The ledger refreshes when viewed.** Normal board/initiative GETs read saved donations and
  `ledger` status from KV. When `ledger.refreshDue` is true, the browser shows those rows and an
  updating indicator while `?refresh=1` refreshes the Safe indexer's results, verifies new and
  pending donations, saves them in KV, and returns the updated page. The board refreshes its
  published initiatives; an initiative page refreshes only its own Safe. A per-initiative KV lease
  shares work across visitors and server instances; other visitors poll KV every two seconds while
  `ledger.updating` is true. Fresh results are reused for `SAFE_SYNC_TTL_SECS` (default 600, minimum
  60). Failures and incomplete backfills retry after 60 seconds while viewed, preserving old rows
  and the resume cursor. The admin sync button can refresh early but respects the lease. Startup
  does not check the chain. The removed `SAFE_SYNC_CRON` setting is ignored. Set `SAFE_API_KEY` for
  authenticated indexer access. Empty/known indexer results need no ledger RPC calls. Donation
  verification shares one lazy block-number lookup per refresh batch; receipt and price reads still
  use RPC. Failed head lookups never bypass the confirmation requirement.
- **A daily production fallback keeps quiet-day snapshots recent.** `server.ts` registers
  `refresh-public-cache-daily` at module scope for 03:00 UTC. Its handler checks the runtime
  `DENO_TIMELINE` before reading KV or calling any upstream service; only the exact value
  `production` proceeds. It refreshes approved initiatives' ledgers and balances through the same
  functions as visitor requests, respecting freshness, cooldowns and active KV leases. Branch,
  preview, local and unknown timelines do no refresh work, even if the job appears in their Cron
  dashboard. Deno supplies `DENO_TIMELINE`; no additional environment configuration is needed.
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
- **Checkbox evidence and transfers are separate.** Versions live in `content/donation-terms/`;
  deploy this directory with the API and restart after publishing terms. `POST /api/donate/accept`
  takes `slug`, `initiativeId`, `chainId`, `recipient`, `version`, `agreed: true`, and `method`.
  Wallet attempts include `wallet: {address, token, amountRaw}`; exchange attempts may include any
  subset of `details: {name, amount, currency}` (amount is token units, not USD). The API validates
  the published/effective document and recipient, records server time and an immutable attempt, and
  establishes a dedicated anonymous HttpOnly/SameSite cookie (Secure on HTTPS). Mutation requests
  require an allowed nonempty Origin and JSON; no wallet login or terms message signature is
  required. The wallet still authorizes the transfer itself. `POST /api/donate/confirm` optionally
  attaches `attemptId` using the same browser cookie. Hash attachment is persisted before RPC
  verification and is idempotent for the same hash; another hash requires a new attempt. Ledger
  refreshes and the production daily fallback retry queued matches for seven days, up to 30 per
  initiative per refresh. Public confirmations remain accounting-only. Legacy `terms` envelopes are
  rejected rather than silently discarded. Wallet matching requires a single eligible transfer, the
  intended sender/token/base-unit amount, and a block after the head observed at acceptance.
  Multi-transfer/ambiguous receipts remain unmatched even when credited. Exchange hashes are
  visitor-reported; optional details alone do not automatically match a donation. Names are private
  labels, not identity proof. Acceptance rows use `browser-checkbox-v1`; separate association rows
  use `wallet-flow-correlated` or `visitor-reported`, always `donorAuthenticated: false`. A public
  hash never grants control over another attempt, blocks another claim, or changes donation rights.
  `GET /api/donate/attempt/:id` is private to its browser session. Acceptance and association data
  have no automatic deletion (apply the published retention policy operationally); anonymous
  credentials and hash-submission windows expire after seven days. No additional IP/user-agent
  evidence is collected. Historical `terms_accept`, `terms_verified`, and correction records are
  preserved unchanged with their original assurance. This mitigates ASVS-03's first-writer poisoning
  by changing the evidence model; it does not claim cryptographic donor consent or establish ASVS
  compliance. See `docs/donation-checkbox-evidence.md` for the residual spoofing risk and validation
  criteria.
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
- **Text is revisioned.** Every change to title, summary, sections, milestones or links (the
  proposer's edit page, the admin editor, content sync) appends an immutable revision under
  `["revision", rfpId, n]`; the initiative row carries the current number. A revision carries the
  structured fields too. Revisions are public; admins can archive a superseded one (hidden from the
  public history, never the current one). Rows written before revisions existed get their text
  snapshotted as revision 1 on their first edit. Historical `details` remain readable in proposals
  and revisions, but new text edits must use structured fields. Editing an old proposal migrates it;
  changing only its page facts preserves the old body.
- Ids are ULID strings. Rate limits live in KV so they hold across isolates. `RATE_LIMIT_MODE` picks
  `enforce` (default), `observe` or `off`. Observe counts every bucket and allows the request,
  except the buckets in `ALWAYS_ENFORCED_RATE_LIMITS` (submissions, support, uploads), which spend a
  real resource and keep refusing. Enforce and observe both log a breach as one JSON line
  (`{"rateLimit":true,"event":"ratelimit.breach",...}` with the bucket name, the sha256 of the
  client key, cap, window and count) when a bucket first passes its cap and again at each 10x
  multiple, so Grafana can show which caps real traffic reaches without one line per request.

## Reusing proposal URLs

A submission can take its title-derived slug from an archived proposal. The archived row moves to
`<slug>-archived-<lowercase-id>` (with an additional numeric suffix if needed), retaining its ID,
history, funds and Safe. The transfer and creation commit atomically. The replacement starts
pending, so its clean URL is private until approval. Archived text may also be resubmitted; pending,
approved and rejected proposals still block duplicate content. Other name collisions retain the
normal suffix allocation. Existing numbered proposals are not renamed automatically.

Duplicate content means matching section text plus milestone names and criteria, ignoring case and
whitespace. Changing only the title or other page facts does not bypass this check. A duplicate
finding names the existing proposal and explains which content must change.

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
`POST /api/comments/:id/report`, `POST /api/support` (the floating Support widget:
`{category,
message, email?, page?, screenshot?}`, tagged and forwarded to `SUPPORT_URL`; 503 until
it is set, 5 per hour per IP).

Signed in: `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/logout-all`,
`POST /api/nickname`, `POST /api/pfp`, `POST /api/pfp/upload`, `POST /api/comments/:id/vote`,
`POST /api/comments/:id/reply` (role-gated), `POST /api/uploads/logo` (multipart `image`, a backer
logo pinned before submitting; returns `{cid, logoUrl}`, the CID is only accepted on a submission
from the same wallet within a day), `POST /api/initiatives/:slug/revisions` (proposer or admin:
title, summary, sections, milestones, links; legacy rows migrate to this format),
`PATCH /api/initiatives/:slug` (proposer while pending, admin always: type, topup, goal,
durationMonths, recipientTeam, recipientUrl, milestoneReviewer, discourseUrl, funders, contact;
after approval a proposer gets 403).

Admin (`/api/admin/...`): `GET dashboard`, `GET|PATCH initiatives/:id`,
`POST initiatives/:id/status`, `POST initiatives/:id/revisions/:n` (archive / unarchive),
`POST|PATCH|DELETE initiatives/:id/pledges[/:pid]`, `POST initiatives/:id/donations/recheck`,
`POST initiatives/:id/sync-donations`, `GET initiatives/:id/safe-deploy-params`,
`POST initiatives/:id/safe-confirm`, `POST comments/:id/:action`, `POST sync-content`,
`GET|POST maintenance[/enter|/exit]`, `GET backup`, `POST restore` (see below).

All bodies and responses are JSON (`{error}` on failure). Private fields (`contact`, `funders`,
historical comment `email`) only appear in admin responses.

### Write fields

- New comments take `initiativeId`, `body`, `name` and the `website` honeypot. They are generic
  comments; category selection, topics and email collection are no longer supported. Previous
  browser bundles sending `type: "other"`, `topic: ""`, `email: ""` still work. Historical
  questions/suggestions remain readable and can be answered/reviewed; the `accept` moderation action
  has been removed.
- Initiative submission and page-fact edits use `goal` and `durationMonths`. The request aliases
  `goalUsd` and `duration` are rejected; response objects still expose `goalUsd`. Text edits reject
  `details` and use sections, milestones and links.
- Safe binding goes through on-chain verification at `safe-confirm`. The initiative editor cannot
  set or clear `safeAddress`.
- Admin pledge writes use `amount` (responses still expose `amountUsd`) and accept a multipart
  `logo` image for a logo change. Direct `logoCid` and `amountUsd` request fields are rejected. This
  does not change submission `backers[].amountUsd` or `backers[].logoCid`, whose uploaded CIDs
  remain bound to the submitting wallet. JSON status-only pledge updates still work.

All write endpoints reject unknown fields with `400 {"error":"Unsupported field: <field>."}`.
Removed fields follow the same rule. This covers JSON and multipart fields (including file fields),
and nested sections, milestones, backers, donation acceptance details and content-sync files; nested
errors name the path, such as `milestones[0].amout`. Validation happens before applying edits or
uploading files. Bodyless actions accept an empty body or `{}` and reject additional fields.
Malformed JSON or a non-object JSON body returns 400, as do unsupported actions. No historical
records are deleted by this API cleanup.

## Maintenance mode, backup and restore

**Maintenance mode** is a flag under `["meta","maintenance"]` (`{on, by, at, note}`) that an admin
toggles from the dashboard: `POST /api/admin/maintenance/enter` `{note?}` and
`POST
/api/admin/maintenance/exit` (both need recent authentication and are audited as
`maintenance.enter` / `maintenance.exit`; `GET /api/admin/maintenance` reads it). While it is on,
every `POST`, `PATCH` and `DELETE` on the API answers
`503 {"error":"The site is in maintenance mode; changes are paused. …","maintenance":true}`, admins
included, except sign-in/out and session management under `/api/auth`, the CSP report, the toggle
itself, `GET /api/admin/backup`, `POST /api/admin/restore`, and the two reads the API takes as POST
(`/api/comments/mine`, `/api/ai-search`). Reads are unchanged, but the background writes a read can
trigger stop too: `?refresh=1` ledger and balance refreshes, the pending-donation re-check on
`GET /api/donate/status/:tx`, the balance revalidation of the admin views, and the daily cron.
`GET /api/board/settings` carries `maintenance: {on, at, note}` for the site-wide banner; the note
is public. Each isolate re-reads the flag every 3 seconds, so other instances follow a toggle within
that window. A refused write is audited as the attempted action with outcome `failure`, not as a
server fault.

**Backup**: `GET /api/admin/backup` (recent authentication, audited as `backup.export`) downloads
`thedao-kv-backup-<stamp>.json`:

    { "format": "thedao-kv-backup/1", "exportedAt": "...", "prefixes": {"rfp": 25, ...},
      "entries": [ { "key": ["rfp", "<id>"], "value": { ...the stored row... } }, ... ] }

Entries are the KV rows verbatim (keys without any `DB_PREFIX`, so a file restores into any
namespace), prefix by prefix in alphabetical order: `checkbox_acceptance`, `comment`, `comment_ref`,
`content_logo`, `donation`, `donation_association`, `donation_by_tx`, `meta`, `nick`,
`pending_association`, `pledge`, `profile`, `reused_rfp_slug`, `revision`, `rfp`, `rfp_by_safe`,
`rfp_by_slug`, `rfp_by_source_slug`, `safe_balances`, `safe_sync`, `vote`. Left out on purpose:
sessions, nonces, rate-limit counters, upload receipts, locks and checkbox sessions (rows that
expire on their own and cannot carry their TTL), the comment claim index (rebuilt on restore), the
three retired `terms_accept*` shapes, and the maintenance flag itself. The file holds every private
field (contacts, funders, comment emails): keep it as safely as the database. A stored value the
format cannot carry (there is none today) fails the export with 500 rather than dropping data.

**Restore**: `POST /api/admin/restore` `{mode?: "merge" | "replace", backup}` (recent
authentication, up to 32 MB, audited as `backup.restore` with the mode as detail) only while
maintenance mode is on (409 otherwise). `merge` (the default) writes only the keys that do not exist
yet; `replace` overwrites existing keys with the file's values. Neither deletes anything, and the
maintenance flag inside a file is ignored. The whole file is validated first and refused as a whole
(`400` naming the first bad entry) before any write; a `200 {written, skipped, claimsRebuilt}` means
every entry was either written or skipped, so re-running a restore is safe. Held comments that were
written get their claim index back with the remaining lifetime, so their authors can still find
them. The dashboard card wraps all of this: enter maintenance, download, restore a file, exit.

## SIWE from the frontend

The token is an opaque random string, stored hashed in KV (7 days, 12 h for admins). The browser
never sees it: with `cookie: true` the verify response carries it in an HttpOnly cookie and the body
is just `{address, isAdmin, expiresAt}`.

```js
const { nonce } = await (await fetch(API + "/api/auth/nonce", { credentials: "include" })).json();
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
const { address: who, isAdmin, expiresAt } = await (await fetch(API + "/api/auth/verify", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, signature, cookie: true }),
})).json();
// then: every fetch with credentials: "include"; POST /api/auth/logout clears the cookie
```

The cookie is `__Host-session` with `Secure` when the Deno request URL uses https, else plain
`session` so local http dev works. Forwarding headers are ignored. The cookie is always
`HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>`. Cross-site writes are refused by the Origin
allow-list (`middleware/headers.ts`), and CORS is the same allow-list with credentials.

Scripts and other non-browser clients leave `cookie` out and get
`{token, address, isAdmin,
expiresAt}` back; they send `Authorization: Bearer <token>` (that is what
`scripts/lib.ts` does). A bearer, when present, wins over the cookie.

`domain` must be in `SIWE_DOMAINS` and `uri`'s origin in the allowed origins (`WEB_ORIGIN`, or
`VITE_SITE_URL`'s origin when that is unset).

## Deploy (Deno Deploy)

One Deno Deploy app for API and site: root directory `/`, entrypoint `server.ts` (the table in the
root README). Set the variables from `.env.example` (no `KV_PATH`). KV and cron are provided by the
platform; each timeline gets its own database. If two deployments must share one KV database, give
each its own `DB_PREFIX`: every key is stored under that first part, so the two never see each
other's rows (changing it on a live deployment starts from empty).

`KV_EVENTUAL_READS=1` serves the public pages' reads (initiative rows and lists, pledges, donations,
revisions, comments, funding snapshots) with Deno KV eventual consistency, from the nearest replica.
Every write keeps strong reads for the entries it checks. It is an experiment: measure with
`deno task bench` on a preview before keeping it on, since a page read right after a write may
briefly show the previous state.

## Scripts

- `ADMIN_PRIVATE_KEY=0x… deno task login` — prints a bearer token (dev wallet whose address is in
  `ADMIN_ADDRESSES`).
- `ADMIN_TOKEN=… deno task sync-content` — pushes the content files.
