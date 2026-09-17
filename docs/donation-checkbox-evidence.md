# Donation checkbox evidence without a wallet message signature

Status: implemented replacement for the terms-signature change (ASVS-03).

## Recommendation

Keep the required checkbox in the site donation flow. Record an acceptance request on the server
before sending a wallet transaction or revealing the exchange address in the widget. Associate it
with an anonymous browser session and a server-generated donation-attempt ID. Then record any
association with a confirmed donation separately, with an explicit evidence type. Do not describe
this association as verified donor consent.

This requires no sign-in or wallet message signature. Wallet donations still require the normal
approval of the transfer itself. Name, amount, and currency are independently optional for the
exchange flow; amount and token remain necessary to construct a wallet transfer.

## What the review found

Commit `dbafcdf723dace3883f59c537131c6a5cb9e970d` added a terms signature after the transfer.
ASVS-03 in `docs/security/asvs-2026-09-15/report.md` demonstrated a specific integrity problem: an
unauthenticated caller could write an arbitrary acceptance against a public transaction hash, and
that first write could prevent later evidence from being recorded.

Removing the signature must not restore that storage model. This proposal changes the assurance the
product promises: a browser submitted agreement, and the server may correlate that event with an
independently verified transfer. It does not establish wallet ownership, the identity of a human, or
that a script really operated a visible checkbox.

## Flow

1. The widget starts with an unchecked checkbox for each donation attempt and links to the exact
   terms version shown. The API accepts only a recognized, effective version. An old local-storage
   timestamp cannot create a new server acceptance or backdate one.
2. After the visitor checks the box and chooses Donate or Show address, the API creates an immutable
   acceptance event with server time, terms content hash, initiative ID, chain ID, recipient, and
   method. The API derives the recipient from the initiative. A displayed recipient that differs
   from the server's current recipient requires restarting the flow.
3. The server binds the attempt to a dedicated anonymous session. No SIWE login is required. Persist
   the event before opening the wallet or revealing the address in this widget. If recording fails,
   show a retry. This is a site workflow safeguard; the address stays public on-chain and elsewhere.
4. For a wallet donation, snapshot the proposed sender, token contract, and exact amount in base
   units before opening the wallet. Changing these details starts a new attempt. The browser
   attaches the returned transaction hash to its own attempt after broadcasting.
5. The API independently checks the successful transfer, chain, recipient, token, sender, and exact
   amount. A match becomes `wallet-flow-correlated`, with `donorAuthenticated: false`. Pending
   transactions or RPC failures leave the association pending. Persist the submitted hash so a
   server retry can finish after the browser closes.
6. For an exchange donation, record the acceptance even if every optional detail is blank. Offer an
   optional transaction hash after withdrawal. A supplied hash can identify a verified transfer, but
   remains a `visitor-reported` association. Amount/currency are retained as private hints for later
   review; this implementation does not automatically infer matches from amounts or timing. Exchange
   fees, delayed withdrawals, pooled sending wallets, and identical deposits can make matching
   ambiguous. A name is a private label, not an on-chain matching key.
7. Credit direct/indexer-detected transfers as usual. Where no acceptance can be associated, show
   `no recorded site acceptance` internally. This means evidence is absent; it does not mean the
   donor rejected the terms or establish their legal position.

## Evidence and storage boundaries

Use separate records for acceptance events, submitted transaction associations, and verified
on-chain donations. An illustrative model is:

| Record                  | Main fields                                                                                                                           | Meaning                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Acceptance event        | Attempt ID, private session reference, terms hash, server timestamp, initiative/chain/recipient, method, optional volunteered details | This session submitted agreement to this document for this attempt. |
| Transaction association | Attempt ID, scoped transaction hash, submitted time, match state, evidence type, checked transfer details                             | This attempt reported or correlates with this transfer.             |
| Donation                | Existing chain-verified accounting record                                                                                             | The initiative received the assets.                                 |

Acceptance timestamps and documents are immutable. Corrections and additional claims append history.
Scope associations by chain, transaction, initiative, recipient, and attempt ID. Multiple attempts
may refer to the same transfer; no anonymous first writer reserves that transfer or blocks later
evidence. Retries within an attempt are idempotent, and attaching a hash requires the session that
created the attempt. Limit one submitted hash per attempt; replacement transactions require a fresh
acceptance attempt rather than silent overwrites. Do not duplicate accounting when several claims
identify the same donation.

Never write this evidence into `terms_verified` with `donor-signature-v1`. Preserve historical
signed evidence and legacy claims with their original classifications. Do not use an anonymous
association to grant voting rights, account access, refunds, or authority over a donation. Existing
authorization must continue to use its own verified evidence.

The current chain verifier sums matching token logs to a recipient and takes the first sender. That
result alone is insufficient to establish an exact sender/amount match for a multi-sender
transaction. Matching therefore requires exactly one eligible transfer to that recipient;
unsupported or ambiguous transactions are left unmatched. Amount comparisons use base-unit integers,
not floating-point USD estimates.

## Controls and limits

Use a cryptographically random session token, stored hashed server-side, in a dedicated Secure,
HttpOnly, SameSite cookie in production. Keep the credential out of URLs and logs. Require CSRF
protection and allowed-origin checks on cookie-authorized mutations; constrain request sizes and
rate-limit both session creation and submissions. Session credentials and initial hash-submission
windows expire after seven days. Queued matching expires seven days after submission. Acceptance and
association records have no automatic deletion; apply the published retention policy operationally,
separately from expiring credentials. Background work handles up to 30 queued matches per initiative
on each ledger refresh, including the production daily fallback. These controls follow
[OWASP's session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Keep acceptance and volunteered names private. Avoid adding IP addresses, user-agent retention, or
browser fingerprinting to the evidence model by default; these do not prove wallet control. Document
the acceptance-record fields alongside the site's data-collection description.

An attacker can create their own session, submit agreement, and name someone else's public
transaction. Pre-recorded details and sequence checks improve correlation but do not eliminate this
possibility, including for pending transactions. Session binding protects someone else's acceptance
record; it does not authenticate the donor. That residual limitation must remain explicit in
exports, admin displays, documentation, and the ASVS retest disposition. Do not claim the original
signature-based assurance or an ASVS pass without reassessment.

## Acceptance checks for implementation

- A wallet donation invokes no terms `signMessage` request and still submits the transfer.
- Exchange address reveal works with name, amount, and currency all blank, after recording
  acceptance. The optional currency starts unset rather than silently asserting USDC.
- Unknown/future terms, client-supplied server timestamps, changed recipients, cross-session
  attachment, and cross-site mutation attempts are rejected.
- Forged claims cannot overwrite, reserve, or suppress other evidence for a public hash.
- Failed, pending, mismatched, and ambiguous transfers never acquire a successful match.
- Receipt failures cannot borrow an existing accounting status to pass the evidence check.
- An exchange hash never becomes authenticated wallet consent; missing details remain missing.
- Closing/reloading the browser after hash submission does not lose queued matching work.
- Historical signed records survive; acceptance names and session credentials stay private.
- Accounting and existing access rights remain independent of checkbox matching.

## Existing terms and implementation locations

The September 14 document already mentions exchanges in section 2.2 and optional name, amount, and
currency in section 8.4. This design follows the workflow described in the supplied lawyer
correspondence; it makes no separate conclusion about enforceability.

The implementation primarily touches `app/components/donate/DonateWidget.tsx`,
`app/components/donate/useDonation.tsx`, `api/routes/donate.ts`, `api/db/terms.ts`,
`api/db/keys.ts`, shared API types, receipt matching, retry processing, and their focused tests. The
shared terms parser and published-version validation from `dbafcdf` are retained. The extra signing
flow is removed; browser evidence uses separate storage from historical signed consent. No new
record is labelled authenticated consent.
