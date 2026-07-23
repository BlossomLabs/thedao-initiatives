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
- `forum` (optional, the Discourse discussion link)
- `status` (optional, `approved` or `pending`; only used when the file is
  first created, default `approved`)
- `pin` (optional, board position 1 = top; sets the admin pin)
- `type` (optional, `rfp` or `grant`, default `rfp`: an RFP is an open
  competitive bid with no preset vendor; a Grant means the team presenting
  the idea does the work)

## Safety rules (enforced by the app)

- Files own the **words and the goal**. The admin panel owns the
  **lifecycle**: editing a file never changes an initiative's status, its Safe,
  or any donation/pledge data.
- Deleting a file never deletes the initiative (archive it in the admin panel
  instead).
- A file with an error (missing title, bad goal) is skipped and reported in
  the sync result; it never blocks the others.
