# Application security profile — Nov 17, 2026

This is a source-derived inventory for the ASVS assessment of b471ac5 plus the reviewed working tree. It records current behavior and missing assurance; it does not invent deployment policies or certify provider controls. The owner confirmed Deno Deploy, Privy, log collection/retention and backup arrangements unchanged from the September review. No secret values were inspected.

## Components and trust boundaries

The browser runs a React application. A Deno/Hono process serves build/client and the API, with Deno KV holding records. Public board/feed responses use explicit serializers; administrative and proposer responses have separate authorization. Ethereum RPC, price feeds, Safe indexing, embedded wallets, image hosting and external AI are separate trust boundaries. First-party Solidity contracts and shared/Python voting implementations receive additional local regression testing, not a formal cryptographic or contract audit.

| Communication | Purpose and data | Trust/control boundary |
|---|---|---|
| Browser to same-origin Hono API | Public reads; signed-in writes via HttpOnly session cookie | Origin guard, backend roles/ownership, JSON field allowlists, no-store for private data |
| Browser to Privy | Email login and embedded-wallet signing | Configured email-only path; upstream OTP/recovery/session controls require provider evidence |
| Browser to WalletConnect/wallets and RPC | Wallet connection and user-directed Ethereum actions | HTTPS/WSS CSP allowlist; third-party messaging and key custody are dependencies |
| Deno to KV | Public/private records, hashed session credentials, indexes, leases | Typed keys and CAS; platform storage encryption, IAM and backup recovery unverified |
| Deno to Ethereum RPC/price contracts | SIWE contract signatures, balances, receipt checks, voting and relay | Fixed/default or operator-configured endpoints; deadlines; new ballot relay gas/fee/cost budgets |
| Deno to Safe transaction service | Discover transfers; chain verification where supported | Fixed base, page/time budgets, redirect refusal and same-origin/exact-path validation for next and resumed URLs |
| Deno to Pinata/IPFS | Public normalized raster upload | Fixed upload host, bearer credential, image rewrite before upload; CID ownership receipt |
| Deno to configured AI service and nexus-api.dappnode.com | Optional ranking, comment/support classification | Operator-configured or fixed service URL/key, request timeout; outputs are data, not executable authority |
| Deno to api.ensdata.net | Public ENS/profile lookups | Fixed host and validated address/name path; distinct from disabled resolver-directed CCIP reads |
| Deno to configured support webhook | Contact, email, message and optional screenshot | Operator-selected destination, quota, 15-second timeout, redirect refusal and generic failure diagnostics |
| Browser to user-linked image/HTTPS destinations | Markdown/media and deliberate link navigation | Sanitization, HTTPS restrictions where defined, noreferrer links; remote-image privacy remains a limitation |
| Deno stdout to Deploy log view | Structured security events and separate diagnostics | Owner-attested platform collection; exact retention, immutable storage, alerts and downstream redaction unverified |

Support and optional AI paths intentionally send supplied support content to configured external services; their privacy/retention assurances are not verified. User discussion URLs are validated as public HTTPS links rather than fetched as arbitrary backend URLs. ENS CCIP gateway reads are disabled. No first-party SQL expression interpreter, OS command execution, LDAP, XPath, JNDI, memcache, SMTP/IMAP, GraphQL, OAuth/OIDC server, SAML or WebRTC media service exists in the deployed request interface. Build tools and test fixtures are not application endpoints. Third-party email codes and wallet messaging remain explicitly assessed dependencies.

## Identities, authorization and sessions

Anonymous visitors read approved/public data. Signed-in wallets manage their own submissions, profiles, reviews and watchlists, subject to feature/badge ownership. Administrators have server-checked current membership; private contacts and funders are visible to the owning proposer or a recently authenticated administrator. Critical administration, private exports and remote session termination require SIWE proof within five minutes. Ordinary administrator edits have a broader session window as documented in docs/session-security.md. Contracts independently enforce signatures, configuration authority and ballot rules.

API credentials are 32 random bytes, indexed by SHA-256, with separate random inventory IDs. Both user and administrator sessions have a seven-day absolute lifetime and one-day idle limit. Passive polling does not renew activity. New authentication rotates the presented credential; **there is no per-account concurrent-session maximum**. Other sessions remain valid until expiry/revocation and are visible in the session inventory. This is the observed behavior, not a proposed cap.

The optional private-preview gate accepts operator Basic credentials or a valid API session. Its new __Host-site_lock cookie is a versioned, random, HMAC-authenticated token with server-enforced thirty-day expiry and origin/account binding. It has no idle tracking or individual revocation; rotating its configured secret invalidates all such cookies. It does not grant wallet/account authority. The preview signing key is a separate 32-byte random SITE_COOKIE_KEY, never derived from the password. Missing/malformed signing material rejects preview startup. The Basic password still has no dedicated brute-force limiter; deployed secret custody and actual entropy are unverified.

Privy email login creates/accesses a wallet that signs SIWE. The API does not accept Privy JWTs as authorization. Signing with an already available embedded wallet is not proof of a fresh email code or a second factor. Privy factor changes, account disable and provider logout do not have verified backchannel termination of all application sessions.

## Inputs, files and expensive operations

JSON bodies must be plain objects; action-specific top-level/nested field allowlists reject mass assignment. shared/draft defines content structures, field lengths, amounts and combined submission checks. Backup import is a distinct administrative trust boundary: versioned JSON, allowlisted KV prefixes, plain data values and duplicate-key checks, with maintenance gating and staged versioned storage. One head/revision CAS publishes the whole restore. Bulk status/moderation and content sync use the same boundary. Request scopes pin their generation; concurrent durable writes abort publication and obsolete requests cannot write. Expiring sessions, quotas, drafts and live leases stay outside the dataset. The daily production cron collects inactive generations after a one-hour grace period, exceeding the ten-minute scope limit.

| Interface | Current limits and handling |
|---|---|
| General API bodies | 2 MiB maximum before handlers; explicit per-action field rules |
| Raster uploads | PNG/JPEG/WebP content only; route byte caps (logos 1 MiB, profile images 512 KiB), 4096 pixels per side, 4 megapixels; decode/strip/rewrite; reject invalid data |
| Image workers | At most two decoders per isolate, 64 MiB decoder policy, disk/delegates disabled; 60-second initialization and 8-second decode deadline; timed-out workers terminated |
| Restore | 32 MiB request cap, 64 KiB UTF-8 value checks and bounded staging batches; atomic publication; no archives extracted |
| Downloads | Generated timestamp or validated slug filenames; private Markdown/backup attachments and no-store; public Markdown uses text/markdown |
| SIWE | Fixed chain/domain/URI/time checks; single-use nonce; per-IP/global route quotas; provider-dependent contract signatures |
| Sponsored ballots | 500,000-gas signature preflight; 4,000,000 final gas ceiling; 20 gwei maximum fee; 0.005 ETH maximum signed cost; quota and lease checks |
| Safe discovery | 20 rows per page, at most ten pages per run, 20-second scheduling budget and 15-second fetch deadline; an in-flight operation may outlive the scheduling budget |
| Other providers | RPC endpoint timeout 10 seconds with failover; AI timeout 25 seconds; Pinata timeout 30 seconds |

These limits do not prove global capacity or denial-of-service resistance. Production observe-mode limits are the bounded September exception, not a waiver for every new costly route. No load test, real spending or credentialed production mutation was performed. Uploaded images are normalized but not antivirus-scanned.

Voting concentration uses registered funding goals for S-Tier and, when enabled, A-Tier. Ballot size and funding continue to use live remaining asks; the three pairwise non-affiliated Initiatives rule remains. The exact implementation/specification and regression evidence are linked in report.md. Arbitrary admin changes to goals/affiliations remain a trusted configuration boundary.

## Data and cryptographic inventory

| Class | Examples | Implemented protection and assurance limits |
|---|---|---|
| Deliberately public | Approved initiative fields, public wallets/transactions, published votes, public images | Explicit public serializers; no promise of deletion from chain/IPFS |
| Private application records | Contacts, funder leads, unpublished/restricted revisions, support content | Owner/recent-admin rules, no-store, scoped client caches; provider storage encryption and retention not independently verified |
| User drafts | Unpublished wallet-scoped form content | Server-side owner authorization, no-store, 256 KiB limit, atomic version checks, deletion tombstones and 30-day expiry; form content remains in browser memory only |
| Authentication material | Session/claim credentials, preview password/token, relayer keys, provider API keys | Random/hashed API sessions; HttpOnly cookies; secrets read from runtime configuration; actual secret entropy, IAM, custody and rotation records unverified |
| Backups | Durable application KV records, including private data | Recent-admin export/restore; transient sessions/nonces/leases excluded; storage encryption, retention and restore drills not evidenced |
| Logs | Structured action/actor/outcome metadata plus separate diagnostics | Bounded JSON security schema and redaction; public wallet IDs retained; platform access/retention/immutability not verified |

Cryptographic implementations are WebCrypto and locked viem/dependencies: CSPRNG for tokens/nonces, SHA-256 for opaque credential indexing and metadata hashes, HMAC-SHA-256 for preview cookies, Ethereum Keccak/secp256k1 signatures and ERC-1271 contract verification. The preview HMAC uses the independent random 256-bit signing key; no key is derived from a password. SIWE and typed voting signatures bind protocol domain/chain/context. Contract-wallet signature logic is delegated to owner code and bounded for sponsored preflight. Deno/edge TLS certificates, Privy custody and KV/backup encryption are provider-managed and not inferred from source. No complete organization-approved key lifecycle or verified post-quantum migration plan was supplied.

Session expiry is explicit; upload ownership receipts last one day. Durable record, backup and diagnostic-log deletion schedules are not fully evidenced. This inventory does not establish applicable regulatory obligations, complete classification approval or provider data-processing controls. Those remain work items in the matrix.
