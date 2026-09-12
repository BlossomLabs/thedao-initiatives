# Initiatives as files

Every `.md` file in this folder (except this README) becomes an initiative
on the board. Publishing is: add or edit a file, push, sync.

## How it reaches the live site

1. Commit + push the file to the repo.
2. The server picks it up either way:
   - automatically at the next app restart, or
   - instantly via the admin dashboard button **"Sync content files"**
     (run after the server has pulled; no restart needed).

## Format

The **filename is the permanent slug** (`vyper-formal-verification.md` lives
at `/initiative/vyper-formal-verification`). Renaming a file makes a NEW
initiative, so pick the name once.

```markdown
---
title: Vyper compiler formal verification
goal: 600000
summary: A machine-checked proof that Vyper compilation preserves the
  meaning of source programs, plus the infrastructure to re-verify
  every future release.
forum: https://forum.example.org/t/vyper-verification/123
---
Full initiative details go here, in markdown: headings, **bold**, lists,
tables, and - [ ] checklists all render on the public page.
```

Frontmatter keys:

- `title` (required, max 140 chars)
- `goal` (required, USD number; `600000` or `$600,000` both work)
- `summary` (recommended, the board-card text; long values may wrap onto
  indented continuation lines as shown above)
- `forum` (optional, the discussion link: a Discourse topic, or a Telegram
  group as a `t.me` link; the page labels each accordingly)
- `status` (optional, `approved` or `pending`; only used when the file is
  first created, default `approved`)
- `pin` (optional, board position 1 = top; sets the admin pin)
- `type` (optional, `rfp` or `grant`, default `rfp`: an RFP is an open
  competitive bid with no preset vendor; a Grant means the team presenting
  the idea does the work)
- `duration` (recommended, whole months from funding to the last milestone;
  renders as "About N months" in the page header)
- `topup` (grants only, `true` when the work is already under way with
  another funder: the page shows the top-up rules panel and "raises the
  remaining" from the pledges)
- `reviewer` (top-ups only, who decides whether the remaining milestones pass)
- `backers` (optional, the pledges already committed: one indented line per
  backer, `Org | $amount | https://link | logo.png`, the link and the logo
  optional, at most 12). The logo is a file name in `content/logos/` (png,
  jpg or webp, under 1 MB): the sync pins it to IPFS once and puts the
  picture on the pledge; the image never lives in the database as text.

  ```markdown
  backers:
    Ethereum Foundation | $100,000 | https://ethereum.foundation/ | ethereum-foundation.png
    Acme Security | 25000
  ```

The process rules are NOT part of the body any more: the site renders the
panel for the type from `content/boilerplate/*.md`. Do not paste a header
table, the proposal window, the milestones preamble, the disclosure sentence,
"Milestone review and acceptance", "Process" or the closing line; the sync
warns when a file still carries a Process or Milestone review heading.

## Safety rules (enforced by the app)

- Files own the **words and the goal**. The admin panel owns the
  **lifecycle**: editing a file never changes an initiative's status, its Safe,
  or any donation data.
- Pledges: a backer named in the file is created on the first sync and kept
  in step afterwards (amount, link, spelling), matched by organization name.
  Whether a pledge is received or withdrawn stays the admin's call, and
  removing a line withdraws nothing: mark it withdrawn in the admin panel.
  Pledges added in the admin panel that the file does not name are left alone.
- An archived initiative stays archived when its file syncs again (same
  filename, same slug). Bring it back with Unarchive in the admin panel.
- Deleting a file never deletes the initiative (archive it in the admin panel
  instead).
- A file with an error (missing title, bad goal) is skipped and reported in
  the sync result; it never blocks the others.
