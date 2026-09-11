"""Strip the canned process text out of an initiative body.

Phase 1 of the submission redesign (docs/prompt-implement-submission-redesign.md):
the header table, the proposal-window row, the milestones preamble, the
disclosure sentence, the "Milestone review and acceptance" and "Process"
sections and the closing line all leave the body. The site renders the rules
panel for the initiative's type instead (content/boilerplate/*.md).

Pure functions here, so the same code runs in the admin dry run, the admin
apply, the CLI and the tests. Matching is deliberately tolerant: the 29 live
submissions paraphrased these blocks in a dozen ways (docs/submissions-
inventory-2026-09-10.md, section 3).

CLI (for anyone with a shell on the box):
    python canned.py --dry-run     per-row unified diff, changes nothing
    python canned.py --apply       backup first, then write
"""
import difflib
import os
import re
import sqlite3
import sys
import time

TABLE_KEYS = ("status", "budget", "proposal window", "indicative duration",
              "anchor backer", "duration")
# the same rows pasted as plain text ("Proposal window: 15 days", "Status\tDraft")
KV_LINE_RE = re.compile(
    r"^\s*\**(status|budget|proposal window|indicative duration|anchor backer)\**\s*[:\t|]\s*(.*)$", re.I)
# canned sentences about the window that live outside the Process section
# ("The proposal window is still real", "...is also an open challenge period",
# a paraphrased Process paragraph starting "The proposal window opens once")
WINDOW_LINE_RE = re.compile(r"^\s*(?:[-*]\s*)?The proposal window (is|opens|will|stays)\b.*$", re.I | re.M)
REVIEWER_RE = re.compile(r"signed off by ([^.\n]+?)\.", re.I)
PREAMBLE_RE = re.compile(r"^\s*These milestones are (a draft|the full project plan)\b", re.I)
DISCLOSE_RE = re.compile(
    r"[^.\n]*must disclose (their|any) relationships? to the teams?, codebases?,? and firms?"
    r"[^.\n]*\.?", re.I)
CLOSING_RE = re.compile(r"^\s*Questions, pushback, better ideas\?.*$", re.I | re.M)
HEADING_RE = re.compile(r"^(#{1,4})\s*(.+?)\s*#*\s*$")
STRIP_SECTIONS = ("milestone review and acceptance", "milestone review & acceptance",
                  "review and acceptance", "process")
DURATION_RE = re.compile(r"(\d+)\s*(?:to|-|–)\s*(\d+)\s*months|(\d+)\s*months?", re.I)
TOPUP_HINT_RE = re.compile(r"already (in progress|under way|underway)|anchor backer", re.I)


def _table_blocks(lines):
    """Yield (start, end) index pairs of consecutive lines that are table rows."""
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            yield i, j
            i = j
        else:
            i += 1


def strip_canned(details):
    """Return (new_details, info). info = {"removed": [...], "duration_months":
    int|None, "topup_hint": bool}. Never raises; an unrecognised body comes
    back unchanged with an empty removed list."""
    text = (details or "").replace("\r\n", "\n")
    removed, duration, topup, reviewer = [], None, False, ""

    def _note_row(ln):
        nonlocal duration, topup
        low = ln.lower()
        if "duration" in low:
            m = DURATION_RE.search(ln)
            if m and m.group(3):          # "12 months", not a range
                duration = int(m.group(3))
        if TOPUP_HINT_RE.search(ln):
            topup = True

    # 1. header table(s): any table block that carries one of the canned keys
    lines = text.split("\n")
    cut = set()
    for a, b in _table_blocks(lines):
        block = "\n".join(lines[a:b]).lower().replace("**", "")
        if any(re.search(r"\|\s*%s\s*\|" % re.escape(k), block) for k in TABLE_KEYS):
            cut.update(range(a, b))
            for ln in lines[a:b]:
                _note_row(ln)
            removed.append("header table (%d rows)" % (b - a))
    # 1b. the same rows pasted as plain text lines
    n_kv = 0
    for i, ln in enumerate(lines):
        if i in cut:
            continue
        m = KV_LINE_RE.match(ln)
        if m and len(ln) < 160:
            cut.add(i)
            _note_row(ln)
            n_kv += 1
    if n_kv:
        removed.append("header rows as plain text (%d)" % n_kv)
    lines = [ln for i, ln in enumerate(lines) if i not in cut]
    text = "\n".join(lines)

    # 2. whole sections by heading: Milestone review and acceptance, Process
    out, i, lines = [], 0, text.split("\n")
    while i < len(lines):
        m = HEADING_RE.match(lines[i])
        if m and m.group(2).strip().lower().rstrip(":") in STRIP_SECTIONS:
            level = len(m.group(1))
            j = i + 1
            while j < len(lines):
                m2 = HEADING_RE.match(lines[j])
                if (m2 and len(m2.group(1)) <= level) or lines[j].strip() == "---":
                    break
                j += 1
            removed.append("section '%s' (%d lines)" % (m.group(2).strip(), j - i))
            rm = REVIEWER_RE.search("\n".join(lines[i:j]))
            if rm and not reviewer:
                reviewer = rm.group(1).strip()
            i = j
            continue
        out.append(lines[i])
        i += 1
    text = "\n".join(out)

    # 3. milestones preamble paragraph
    paras = text.split("\n\n")
    kept = []
    for p in paras:
        if PREAMBLE_RE.match(p):
            removed.append("milestones preamble")
            continue
        kept.append(p)
    text = "\n\n".join(kept)

    # 4. disclosure sentence (a bullet or line of its own, or embedded in a paragraph)
    def _disc(m):
        removed.append("disclosure sentence")
        return ""
    text = DISCLOSE_RE.sub(_disc, text)
    text = re.sub(r"^\s*[-*]\s*$\n?", "", text, flags=re.M)     # bullet left empty

    # 4b. canned window sentences that sit outside the Process section
    n_win = len(WINDOW_LINE_RE.findall(text))
    if n_win:
        text = WINDOW_LINE_RE.sub("", text)
        removed.append("window sentence (%d)" % n_win)

    # 5. closing line (with or without a telegram link)
    if CLOSING_RE.search(text):
        text = CLOSING_RE.sub("", text)
        removed.append("closing line")

    # 6. tidy: trailing separators, runs of blank lines, trailing spaces
    text = re.sub(r"\n[ \t]*---[ \t]*\n(\s*)\Z", "\n", text)
    text = re.sub(r"[ \t]+$", "", text, flags=re.M)
    text = re.sub(r"\n{3,}", "\n\n", text).strip("\n")
    if text.endswith("\n---"):
        text = text[:-4].rstrip("\n")
    return text, {"removed": removed, "duration_months": duration, "topup_hint": topup,
                  "reviewer": reviewer if topup else ""}


def has_canned_headings(details):
    """True when a body still carries a Process or Milestone review heading."""
    for ln in (details or "").split("\n"):
        m = HEADING_RE.match(ln)
        if m and m.group(2).strip().lower().rstrip(":") in STRIP_SECTIONS:
            return True
    return False


def row_diff(title, old, new):
    return "".join(difflib.unified_diff(
        (old or "").splitlines(True), (new or "").splitlines(True),
        fromfile="%s (before)" % title, tofile="%s (after)" % title, n=1))


def plan(rows):
    """rows: iterable of sqlite rows/dicts with id, title, details, duration_months,
    topup. Returns a list of per-row plans (only rows that change)."""
    plans = []
    for r in rows:
        new, info = strip_canned(r["details"])
        set_duration = (r["duration_months"] in (None, 0)) and info["duration_months"]
        set_topup = info["topup_hint"] and not r["topup"]
        set_reviewer = info["reviewer"] and not (r["milestone_reviewer"] or "")
        if new == (r["details"] or "") and not set_duration and not set_topup and not set_reviewer:
            continue
        plans.append({"id": r["id"], "title": r["title"], "new": new,
                      "removed": info["removed"],
                      "duration_months": info["duration_months"] if set_duration else None,
                      "topup": 1 if set_topup else 0,
                      "reviewer": info["reviewer"] if set_reviewer else "",
                      "diff": row_diff(r["title"], r["details"], new)})
    return plans


def backup_db(db_path, dest_dir):
    """SQLite online backup (consistent while the app runs)."""
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "rfps-%s-pre-strip.db" % time.strftime("%Y%m%d-%H%M%S"))
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(dest)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    return dest


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import config
    import db as _db
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"
    plans = plan(_db.list_rfps(("pending", "approved", "rejected", "archived")))
    for p in plans:
        print(p["diff"])
        print("-- id %s: %s%s%s\n" % (
            p["id"], ", ".join(p["removed"]) or "no text change",
            "; duration -> %s months" % p["duration_months"] if p["duration_months"] else "",
            "; top-up" if p["topup"] else ""))
    print("%d of the rows change" % len(plans))
    if mode == "--apply" and plans:
        dest = backup_db(config.DB_PATH, os.path.join(config.BASE_DIR, "backups"))
        print("backup:", dest)
        for p in plans:
            fields = {"details": p["new"]}
            if p["duration_months"]:
                fields["duration_months"] = p["duration_months"]
            if p["topup"]:
                fields["topup"] = 1
            if p["reviewer"]:
                fields["milestone_reviewer"] = p["reviewer"]
            _db.update_rfp(p["id"], **fields)
        _db.set_meta("canned_strip_applied_at", _db.now())
        print("applied")
