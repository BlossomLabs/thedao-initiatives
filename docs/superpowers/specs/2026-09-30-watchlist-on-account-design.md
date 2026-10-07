# Watchlist on the account

A follow-up to the board watchlist (#58), in its own PR stacked on it. Today the
watchlist lives only in the browser (`localStorage`, key `thedao:watchlist`).
This adds a watchlist stored on the signed-in account, and offers to move the
browser's list there after sign-in.

## Goal

- Someone who bookmarks initiatives while signed out can keep them on their
  account and see them wherever they sign in.
- Nothing moves without their say: declining keeps the list in the browser.
- They can stop the question for good in this browser.
- Open tabs stay in step without a reload.

## Decisions

- The offer is a small card under the wallet button, not a dialog.
- Moving means: the account list gains the browser's ids (added to anything
  already there, never replaced), then the browser list is cleared.
- Add and remove are explicit calls, never a toggle, so a retried or duplicated
  request cannot flip the result.
- The account list is not copied into `localStorage`, so it does not linger in
  the browser after sign-out.
- "Don't ask again" remembers the answer it was ticked with, per account in this
  browser: with Move, later bookmarks move on sign-in without asking; with Not
  now, it never asks that account again.

## Data and API

**Record.** `["watchlist", address]` (address lowercased) holds
`{ ids: string[], updatedAt: number }`. It exists only once the account has
moved a list; its existence is what marks the account as using the account
watchlist. At most 200 ids. The `watchlist` prefix joins `BACKUP_PREFIXES`
(user data, like `profile`).

**Routes** (all `requireAuth`; a session only reads and writes its own record):

| Call | Does | Returns |
|---|---|---|
| `GET /api/watchlist` | reads the list | `{ ids }`, or 404 when the account has none |
| `POST /api/watchlist/import` `{ ids }` | adds ids in one atomic write (checked against the record's versionstamp, retried on conflict), creating the record | `{ ids }` |
| `PUT /api/watchlist/:initiativeId` | adds one id; already there is a no-op | `{ ids }` |
| `DELETE /api/watchlist/:initiativeId` | removes one id; absent is a no-op | `{ ids }` |

- **Import** drops ids that are not currently approved initiatives (a browser
  list can hold ones archived since) instead of failing. More than 200 ids
  after the merge, or a body that is not an array of strings, is a 400.
- **PUT** of an id that is not an approved initiative is a 404; a list already
  at 200 is a 400.
- **Rate limit:** `watchlist:<address>`, 60 writes a minute (import, PUT and
  DELETE share it), 429 when over.
- **`/api/auth/me`** gains `hasWatchlist: boolean` (the record exists), so the
  client picks its source without another request.

## Client

**Which list is used**

| Situation | The board shows | The bookmark writes to |
|---|---|---|
| Signed out | the browser list | the browser |
| Signed in, `hasWatchlist: false` | the browser list | the browser |
| Signed in, `hasWatchlist: true` | the account list | the account (`PUT` / `DELETE`) |

- `useWatchlist()` keeps its shape (`ids`, `has`, `toggle`) so the board and
  cards do not change; internally `toggle` calls add or remove by the current
  state. The account list is a TanStack Query entry keyed by address; the hook
  updates it optimistically and rolls back on failure, with a polite live
  message: "Couldn't update your watchlist."
- On sign-out the account entry is dropped; the board falls back to the
  browser list.

**Other tabs**

- Browser list: unchanged, the `storage` event on `thedao:watchlist`.
- Account list: after every successful import, add or remove, the tab posts
  `{ address, ids }` on a `BroadcastChannel("thedao:watchlist")`; other tabs
  signed in as that address put it into their query entry. Tabs also refetch
  the account list when they regain focus (changes from other devices). Where
  `BroadcastChannel` is missing, the focus refetch alone keeps tabs close.

**The card**

- **Shows when** signed in, the browser list is not empty, and this browser holds
  no answer for the account: not "always", not "never", and not "later" for the
  current sign-in. This also covers a later sign-in after new bookmarks made
  while signed out.
- **Moves without asking when** the account's answer is "always" and the browser
  list is not empty: the import runs once on sign-in, and on success nothing
  shows; screen readers are told "Watchlist moved to your account." On failure nothing is
  shown and nothing is cleared; the next sign-in tries again.
- **Where:** under the wallet button, 420px wide, not modal; full width under
  the header on phones. It does not take focus; it is announced politely.
- **Copy:**

  > **Keep your watchlist on your account?**
  > You have 3 initiatives on this browser's watchlist. Move them to your
  > account to see them wherever you sign in.
  >
  > [Move to my account] [Not now] ☐ Don't ask again (one row)

  One initiative reads "You have 1 initiative on this browser's watchlist."
- **Move to my account:** `POST /api/watchlist/import`; on success the browser
  list is cleared, the card closes (nothing visible replaces it; a
  status element tells screen readers "Watchlist moved to your account.") and
  the new list is broadcast. On failure it reads "Couldn't move
  your watchlist. Try again." and nothing is cleared; a 400 for the limit reads
  "Your watchlist is over 200 initiatives. Remove some and try again."
- **Move to my account with "Don't ask again" ticked** also records "always" for
  the account.
- **Not now** (or the close button) hides the card until the next sign-in
  ("later"); with "Don't ask again" ticked it records "never" for the account.
- **Storage:** one `localStorage` key, `thedao:watchlist-ask`, holding a JSON
  object from lowercased address to `"always"`, `"never"` or
  `"later:<session expiresAt>"`. Other tabs follow through the `storage` event.
  Storage off: the browser list lives in memory for the page view, so a user can
  bookmark and be offered the move.
- **Size:** the card's code is a lazy chunk loaded only when it would show;
  the header slot and the store add about 0.2 kB gzipped to the first load.

## Errors

- 401 (session gone): nothing changes locally; the card returns at the next
  sign-in.
- Network failure on add or remove: rollback plus the live message.
- Import failure: the browser list stays; the card offers Try again.

## Tests

- **API** (`api/tests/watchlist.test.ts`): signed out is 401; one account never
  reads another's list; import creates, merges, dedupes and drops non-approved
  ids; import over 200 is 400; PUT and DELETE are idempotent; PUT of an unknown
  id is 404; the rate limit returns 429; `/me` reports `hasWatchlist`; the
  prefix is in `BACKUP_PREFIXES`.
- **Web:** the hook picks the right source in the three situations; a broadcast
  updates another tab's entry; the optimistic add rolls back on failure; the
  card shows and hides by the rules above; Move clears the browser list only
  after the server succeeds; Not now and Don't ask again persist as specified;
  "always" moves on the next sign-in without the card; another account on the
  same browser is still asked.

## Out of scope

- Moving the account list back to the browser.
- Notifications about watchlisted initiatives.
- A watchlist page or sharing a watchlist.
