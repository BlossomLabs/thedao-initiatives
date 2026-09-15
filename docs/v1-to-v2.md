# From v1 (Flask) to v2 (Deno): what changed and why

v1 is the Flask + SQLite MVP at the repository root, exercised on the private test server at
fund.thedao.fund during summer 2026; it never took real traffic. v2 is the rebuild under `web/`: a Deno + Hono + Deno KV API and a React Router
SPA, shipped as one Deno Deploy app. v2 keeps every feature and rule of v1 (Safe-per-initiative,
verified donations, pledges, comments with roles, AI search, terms gate, private preview) and
changes how they are built. The list below is the executive summary; each point says what moved
and the reason behind it.

## Hosting and operations

- **There is no server to run any more.** v1 needed a VPS with systemd, gunicorn, Caddy, a
  persistent disk for `rfps.db` and `uploads/`, and a nightly backup cron. v2 is one Deno Deploy
  app (root `web/`, entrypoint `server.ts`) with the database and cron provided by the platform,
  so deploying is a push and there is nothing to patch, back up or reboot.
- **The background donation scanner is gone; donations come from the Safe Transaction Service.**
  v1 ran a thread inside the app that polled mainnet every few minutes for every initiative's
  Safe, held a file lock so only one process scanned, and depended on a paid RPC key to avoid rate
  limits. v2 asks Safe's own indexer (one authenticated request per Safe, on a `Deno.cron`
  schedule, time-boxed with a resume cursor) which transfers reached each Safe, and still
  re-verifies every new transaction over RPC before crediting it, so amounts keep coming from the
  chain. Page reads never touch Safe or the chain.
- **One origin for site and API.** The API lives under `/api` on the same domain as the pages, so
  there is no CORS, no second deployment and one `.env`. The private-preview lock covers pages,
  assets and API alike: HTTP Basic Auth once, then a stateless signed cookie, because browser
  requests that carry a bearer token cannot also carry Basic credentials.
- **Uploads go to IPFS.** Backer logos and profile pictures were written to the server's disk in
  v1 (and had to be backed up); v2 pins them through Pinata and stores only the CID, which is the
  natural fit for a platform without a disk.
- **AI search and comment screening call Dappnode Nexus instead of DeepSeek.** Both versions
  talk to an OpenAI-compatible chat API, so this is a change of endpoint and model, not of code:
  `https://nexus-api.dappnode.com/v1` and `dappnode/qwen3.8-27b`. Dappnode already runs
  TheDAO's Ethereum staking, so the fund's AI traffic now goes to a partner it already trusts
  rather than to a third-party vendor. Nexus is Dappnode's "Private AI Gateway for Builders":
  requests are routed through Dappnode's own TEE, stripped of identifiable information and
  sent without the caller's IP, with zero data retention, so a donor's "what do I want to fund"
  query or a comment under review never becomes someone's training data. The Qwen model they
  serve is open-weights and offered free of charge, which also removes the per-call spend and
  the daily cap that DeepSeek required.
- **Content stays "as code", but sync is push-based.** v1 read `content/rfps/*.md` from the disk
  next to the app. v2 has no disk, so `deno task sync-content` (or the admin dashboard, picking the
  folder in the browser) pushes the files to the API. Files still own the words and the goal; the
  admin panel still owns status, Safes and money. The donation terms skip the API altogether:
  `content/donation-terms/<date>.md` (one file per version) is bundled into the site at build time.

## Authentication and identity

- **Admins have no password; they sign in with Ethereum.** v1 had a shared admin password
  (plus an optional wallet login) and Flask cookie sessions with CSRF tokens. v2 has exactly one
  way in for everyone, Sign-In with Ethereum (EIP-4361): a wallet whose address is in
  `ADMIN_ADDRESSES` gets an admin session, everything else a normal one. No secret to rotate, no
  password to share, and an audit trail of which wallet did what.
- **One signature per session instead of one per action.** In v1 every comment, vote, reply,
  nickname and picture change asked the wallet to sign a purpose-built message, with a server-side
  replay cache to stop reuse. In v2 the SIWE signature yields a bearer token, and the token
  authorises the rest, so the wallet prompt appears once. Connecting a wallet and signing in are a
  single step; a refused signature disconnects the wallet again, so a connected address is always
  a signed-in one.
- **Wallets connect through wagmi instead of a hand-rolled bridge.** v1 discovered browser
  wallets itself (EIP-6963 announcements, a race between extensions, a vendored WalletConnect
  provider bundle) in `static/app.js`. v2 uses wagmi + viem for injected wallets and
  WalletConnect, with one session context on top, so reconnect on reload, account switches and
  chain checks are handled by a maintained library rather than by us.
- **Identity is applied everywhere and follows one rule: ENS first, then the site profile, then a
  short address.** v1 preferred the site nickname and only fell back to ENS in the top bar. v2
  resolves the ENS primary name and avatar record first, then the nickname and chosen or uploaded
  picture, then the deterministic fallback, and uses that one component for the top bar, comment
  authors, donors, backers, "Proposed by" and the admin tables. ENS-sourced fields cannot be edited
  on the site, and a `.eth` display name is only accepted from the wallet that name resolves to.
- **Only signed-in users can suggest an initiative, and that is what lets them edit it later.**
  v1 accepted the suggestion form from anyone, with an optional private contact, so a submission
  had no owner and could only ever be changed by an admin. v2 requires a SIWE session and a
  display name (ENS or site), records the proposer's wallet on the initiative and shows it
  publicly as "Proposed by". Because every initiative now has an owner, the proposer can come
  back and edit it, gets the PROPOSER role in comments, and can see the submission while it is
  still under review.
- **Anyone can reply, not only role holders.** v1 refused replies from anyone without a role:
  the team, curators and ETHSecurity badge holders could answer, a plain wallet or an anonymous
  visitor got a 403. v2 opens replies to everyone, signed in or with just a name, because a Q&A
  where only insiders may answer stays empty. The safeguards move from the gate to the queue:
  team, proposer, curator and badge-holder replies publish at once and mark a question answered;
  every other reply goes through the same AI screening as a top-level post (through Nexus) and
  may be held for admin review, with a private claim token so the author still sees it;
  anonymous replies are limited to three per hour per address, and a `.eth` name is only
  accepted from the wallet it resolves to.
- **Roles are decided live where they can be.** ADMIN and PROPOSER tags on comments are computed at
  view time from the current state, so a change of team or owner updates old comments too; the
  other roles (curator, badge holder, donor) stay snapshotted at post time as before.

## Cryptography and correctness

- **We do not roll our own crypto any more.** v1 carried a hand-written secp256k1 (point addition
  and multiplication, `personal_sign` recovery), its own EIP-55 checksum and ABI encoders, with
  keccak from pycryptodome. v2 delegates hashing, addresses, EIP-191 recovery and the EIP-4361
  message to viem, the same library the frontend uses to build the login message, so the two ends
  cannot drift and the audited code path is the widely used one.
- **On-chain rules are unchanged.** Every approved initiative still gets its own 3-of-5 Safe
  deployed from the admin wallet through the canonical factory, verified on-chain (owners,
  threshold, singleton, fallback handler) before donors see the address; donations are still
  credited only after the Transfer log is read from mainnet at `MIN_CONFIRMATIONS` depth, with
  Chainlink pricing and staleness checks for non-USD stables. The server still holds no keys.
- **Every write is atomic and typed.** Deno KV transactions replace SQLite statements; ids are
  ULIDs; rate limits live in KV so they hold across isolates. The API has its own test suite
  against an in-memory KV with a scripted fake RPC, and the web app has Vitest, both runnable in
  seconds without a network. (CI still runs the v1 Python checks; wiring the v2 suites into it is
  pending.)

## The site itself

- **Pages feel faster because the site is a single-page app.** v1 rendered every page on the
  server and reloaded on each click. v2 ships a prerendered shell for the board, submit and terms
  pages, then navigates client-side: the board response already carries what an initiative page
  needs, initiative pages are prefetched on hover, and TanStack Query keeps the data cached, so
  moving between board and initiatives is instant and the first paint has the brand background
  and fonts before any JavaScript runs.
- **Styles come from the design system.** v1's `static/style.css` was a hand-tuned pixel
  implementation of the Figma "TheDAO Sites" frames. v2 expresses the same numbers as Tailwind v4
  tokens and shared components (buttons, fields, panels, chips, breadcrumbs, dialogs), so new
  pages are built from the same parts and match the Figma instead of copying CSS.
- **Markdown is rendered in the browser, sanitised.** v1 rendered initiative details with
  Python's `markdown` + `nh3`. v2 stores and returns the raw markdown and renders it client-side
  with a strict sanitiser (no scripts, iframes, handlers or `javascript:` URLs), which is what
  lets the same text be shown rendered or as a word-level diff.
- **Proposers edit their own initiative, and everyone can navigate the revisions.** New in v2:
  the proposer (or an admin) can change the title, summary and details from an edit page; the
  goal, forum link and type stay with the team. Every change, whether from the edit page, the
  admin editor or a content-file sync, is stored as an immutable revision that goes live at once,
  so the text people see is always the latest one and nothing is ever overwritten silently. On
  the initiative page anyone can step through the history, previous and next, see who wrote each
  version and when, and view it either as the page looked at the time or as word-by-word changes
  against the version before. Admins can archive a superseded revision to hide it from the public
  history, never the current one, and can bring it back.
- **"Backers", not "sponsors".** Companies that pledge are called backers throughout v2 (pledge
  band, backers section, admin), matching the language of the initiative pages and the Figma.
- **Smaller everyday improvements carried along:** the account menu instead of a footer admin
  link (the Transparency link left the top bar), admin-only side panel on initiative pages, "attach an existing Safe" next to "deploy",
  dismissing reports without discarding a comment, owner field in the admin editor, a full-width
  suggest page with the "give this guide to your AI" sidebar, and the round-2 batch (donation
  terms gate, 50/500/5k/50k chips, funder leads page with CSV) at parity with v1.

## What did not change

- The money flow, the token list, the confirmation depth, the pricing feeds and the Safe
  configuration are the same as v1 and were verified against mainnet in July 2026.
- The content files, their frontmatter format and the permanent slugs are the same, and the
  one-off `import-sqlite` script carried the v1 database over.
- Round voting by badge holders remains future scope in both versions.

## Upstream batch of 2026-09-09 to 2026-09-11: what reached v2

Upstream (giveth/thedao-rfps) merged fourteen v1 commits in those three days: Griff's content
edits, the submission redesign (phases 1 and 2) and a handful of page tweaks. They were merged
into `staging` on 2026-09-11; v2 got the rules panels and the page facts the same day. Everything
outside `web/` is byte-identical to upstream. This section says, per v1 change, whether v2 has it
and where it differs.

### Landed as-is

- **Content edits** (EIP compliance and Vyper became grants, OPSEC rewrite, EDR tightening,
  SEAL frameworks listed). The files under `content/rfps/` are shared, so v2 shows the same text
  after a `deno task sync-content`. Nothing to port; the sync is the only step.
- **Guide v3 (`llms.txt`).** Mirrored into `web/public/llms.txt` as the drift test requires.
  Note the consequence below: the guide now describes a paste-first form that v2 does not have.

### Landed, but differently

- **Rules panels.** v1 reads `content/boilerplate/{rfp,grant,topup}.md` from disk on every
  request. v2 has no disk, so the three files are bundled at build time (`app/data/rules.ts`),
  the same way the donation terms already were; a test pins the bundle to the repo files. The
  panel sits where v1 puts it, after the details and before the comments, in the same
  green-bordered panel the Donate card uses, with the version stamp underneath. Two things v1
  has were left out on purpose: the per-row `boilerplate: auto | none` switch (v2 has no legacy
  rows to protect, every initiative gets its panel), and the collapsible copy of the panel on
  the submit form (the v2 form was not touched).
- **Page facts.** v1 adds a line under the title with goal, duration, "already committed by
  A, B", the remaining amount on top-ups and the milestone reviewer. In v2 the funding panel
  already shows the goal and the pledged total, so the line was deduplicated instead of copied:
  - The two chips ("top-up, work under way", "to <team>") sit next to the type badge as in v1.
  - The rest moved to a "Key facts" side card under the Donate card: expected duration,
    recipient, "already committed / raises the remaining" (top-ups only) and milestone reviewer
    (top-ups only). Two columns with a divider between rows; rows that do not apply are omitted.
  - Backer names are not listed in prose. The Backers section moved up to sit right under the
    funding panel instead, is hidden when nobody has pledged, and every backer shows the round
    logo or the silhouette placeholder the board card uses.
- **Recipient team.** v1 stores a name only. v2 stores a name and an https link, so the "to
  <team>" chip and the Key facts row link to the team. The link is validated as https on every
  write path and guarded again at render, so a `javascript:` value can never become an anchor.
- **Page fields in the data model.** Same five facts as v1's SQLite columns (`duration_months`,
  `recipient_team`, `topup`, `milestone_reviewer`, plus the new `recipient_url`), as KV record
  fields with defaults for rows written before them. Front matter reads the keys v1 documents
  (`duration`, `topup`, `reviewer`) with the same rules (whole months, top-up on grants only,
  reviewer kept only on top-ups), plus two web-only keys, `recipient` and `recipient_url`.
- **Admin manage page shows only the fields for the type.** Same behaviour as v1's commit:
  recipient and the top-up flag appear for grants, the reviewer for top-ups, live on the type
  select. v2 also clears the grant-only fields server-side when a row is switched to an RFP, and
  the reviewer when the top-up flag is dropped, so a type change never leaves stale facts.

### Ported on 2026-09-12: the submission redesign, done the v2 way

The rest of the batch landed the next day, as five shippable steps. v1 is the requirements; the
build uses v2's design system and infrastructure.

- **One rules module for both sides.** `web/shared/draft/` is the TypeScript port of `draft.py`
  (section dictionary, alias map, amount parser, paste splitter, milestone grammar, checks,
  duplicate-body key) and is imported by the Deno API and by the React app, so the form and the
  server run the same code. v1 kept two copies (Python and `submit.js`) and a test to keep them
  equal.
- **Structured initiatives are revisioned.** Sections per type, milestones and links live on the
  record and on every revision next to title and summary; `details` is legacy-only. The KV value
  size caps the body at about 40,000 characters, enforced on every write path. The revision
  "changes" view diffs each section, the milestones (as their markdown) and the links.
- **Public page.** Sections render under site-owned headings in type order; milestones are
  lettered cards with the amount, an "adoption milestone" chip, and on top-ups a "done" chip
  with the delivered link or a "target Nov 2026" chip; criteria are the checkbox-as-bullet list;
  links are a list. "What happens next" is per type in the side card.
- **Submit form.** Paste box first, mirrored with the fields below in both directions (v1 was paste-only);
  the live checks moved to the sticky sidebar: required questions answered, milestone total
  against the goal, adoption line, and every error or warning as a jump link, with the same
  copy line as v1. Findings still paint on the field they belong to, missing answers stay quiet
  until the first submit attempt, and the preview renders the real page components. Autosave,
  examples per section from the guide, the rules panel above Submit, and the honeypot are as in
  v1. Backer logos upload one by one to IPFS before the JSON submit (the API body limit rules
  out one multipart request); backers become pledge rows the admin reviews.
- **Editing.** New in v2: the proposer edits with the same form. While pending everything is
  open, including type, goal, duration, recipient and the private fields; after approval the
  money facts lock and only text, milestones and links stay editable. Admins use the same form,
  are not blocked by the editorial rules, and see the open findings listed under Save. A legacy
  body is migrated by pasting it into the box.
- **Content sync is strict.** A content file that does not split cleanly into the sections and
  milestones of its type is an error, not a legacy body. The five files in `content/rfps/` were
  rewritten to the guide's headings (Scope became In scope and Out of scope; the grants' Existing
  work and Hard requirements became Why a grant and Commitments; adoption milestones flagged;
  the ethdebug top-up carries done, delivered and target-month lines). This is the one place
  v2's tree now differs from upstream on purpose.

- **Verified in the browser on 2026-09-12** against the gold-standard example: paste and sort,
  the checks card, error painting and the jump to the first problem, preview, submit, the pending
  page, a proposer edit producing revision 2 with its word-level diff, and the phone-width layout.
  Two operational notes: the ethdebug top-up has no milestone named adoption, so its admin editor
  shows that one open point until Griff flags one; and its "already committed by Argot Collective"
  header line depends on the Argot pledge row existing, as in v1.

### Still not ported

- The v1 admin migrations "Strip canned text" and "Structure" (v2 has no legacy rows to convert
  in bulk; a single row migrates through the paste box).
- The `links` field's v1 rendering; v2 renders links only when they are https.

## v1 removed on 2026-09-15

initiatives.thedao.fund, served by v2 on Deno Deploy, is the live site and fund.thedao.fund is
deprecated, so the Flask app left the repository: `app.py` and the other Python modules,
`templates/`, `static/`, `tests/`, the VPS deploy scripts, DEPLOY.md and HANDOFF-DEVOPS.md, the CI
deploy job and the weekly live-chain check, and the one-off `import-sqlite` script (the SQLite to KV
import is done). The v2 tree moved from `web/` to the repository root, next to `content/` and
`docs/`, which keep their paths, so the `../` reach-outs and the Vite `fs.allow` entries are gone.
The repo-root `llms.txt` and its mirror test went too: `public/llms.txt` is the one guide, served
as-is at `/llms.txt` and bundled into the submit form. Before the removal the v1 tests were checked for cases v2 lacked: `tests/test_draft.py` was
already covered case for case by `shared/draft/*.test.ts`; `tests/test_markdown.py` (GFM rendering
and HTML sanitisation) became `app/components/Markdown.test.tsx`.

Upstream (giveth/thedao-rfps) still carries v1. `git merge upstream/main` keeps working for
`content/` and `docs/`; changes to the Python files and to upstream's root `llms.txt` arrive as
modify/delete conflicts, resolved with `git rm` (apply a guide change to `public/llms.txt` by
hand), and their intent is ported by hand and noted here. Watch one thing: git's rename detection can pair upstream's
single `content/donation-terms.md` with a published `content/donation-terms/<date>.md` and edit it.
A published terms file is never edited, so restore it from `main` after every merge.
