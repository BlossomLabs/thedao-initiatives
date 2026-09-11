"""Submission redesign, phase 2: one question per section, milestone rows,
paste-to-fill. This module is the server-side mirror of static/submit.js
(docs/prototype/parts/p4_script.html): the field dictionary, the amount
parser, the paste splitter and the checks. The client is a convenience; the
server is the gate, so every rule here runs again on submit.

Stdlib only. Pure functions, so the migration, the admin, the tests and the
submit route share one implementation.
"""
import json
import re

# ---------------------------------------------------------------- fields
# One question per section. The site owns the heading; the submitter answers
# the question. Order is the order on the page, and it differs by type.
FIELDS = {
    "why": {"heading": "Why this matters", "rows": 7,
            "q": "What gap does this close, and what can people do afterwards that they cannot today?",
            "helper": "1 to 2 short paragraphs or a bullet list."},
    "in_scope": {"heading": "In scope", "rows": 8,
                 "q": "What gets built or delivered?",
                 "helper": "Concrete deliverables. This is also where you say what the money actually pays for."},
    "out_scope": {"heading": "Out of scope", "rows": 5,
                  "q": "What is deliberately not included?",
                  "helper": "This is where the expensive misunderstandings get prevented."},
    "existing": {"heading": "Existing work", "rows": 4,
                 "q": "What prior art should bidders build on?",
                 "helper": "Links. Say what would justify building on something else. Write none if there is nothing."},
    "who": {"heading": "Who we expect to do this", "rows": 7,
            "q": "What does a winning team look like, and who co-drafted this initiative?",
            "helper": "Nobody is pre-selected. Name co-authors and your own relationship to any team or codebase named above."},
    "hard_req": {"heading": "Hard requirements", "rows": 9,
                 "q": "What must every proposal meet or be ignored?",
                 "helper": "Numbered. Verifiable acceptance, a maintenance plan, plus what the domain demands. Open source is welcome, not required: state the license you expect."},
    "team": {"heading": "The team", "rows": 6, "grant_only": True,
             "q": "Who does the work? Names, roles, track record, links.",
             "helper": "Also state any other funding you have for this work, and your relationships to codebases or firms named in this initiative."},
    "why_grant": {"heading": "Why a grant: what already exists", "rows": 7, "grant_only": True,
                  "q": "What have you already built or done that gives you a decisive head start, and where can a stranger check it?",
                  "helper": "Links to code, reports, deployments. Say why the price is below a from-scratch build. If the head start is thin, say so, the admin may ask you to resubmit as an RFP."},
    "commitments": {"heading": "Commitments", "rows": 6, "grant_only": True,
                    "q": "What do you commit to on license, maintenance after the money is spent, and pinned targets? Any exception you are asking for?",
                    "helper": "What you commit to on license, maintenance after the money is spent, and pinned targets. State any exception you are asking for."},
}
SECTIONS = {
    "rfp": ["why", "in_scope", "out_scope", "existing", "who", "hard_req"],
    "grant": ["why", "team", "why_grant", "in_scope", "out_scope", "commitments"],
}
SECTION_KEYS = list(FIELDS)          # every section column, both types
PAGE_KEYS = ["title", "summary", "goal", "duration", "recipient", "backers",
             "links", "funders", "contact"]

# heading aliases: the contract with the guide. Change the guide when you change this.
ALIASES = {
    "title": "title",
    "short summary": "summary", "summary": "summary",
    "funding goal": "goal", "funding goal (usd)": "goal", "budget": "goal", "funding": "goal",
    "expected duration": "duration", "expected duration (months)": "duration",
    "duration": "duration", "indicative duration": "duration",
    "recipient team": "recipient",
    "backers": "backers", "backers already committed": "backers",
    "already committed": "backers", "already committed (usd)": "backers",
    "links": "links", "link": "links",
    "who is likely to fund this": "funders", "who is likely to fund this?": "funders",
    "funders": "funders", "contact": "contact",
    "why this matters": "why",
    "in scope": "in_scope", "scope": "in_scope",
    "out of scope": "out_scope",
    "existing work": "existing", "prior art": "existing",
    "who we expect to do this": "who", "who we expect to do this work": "who",
    "hard requirements": "hard_req", "requirements": "hard_req",
    "the team": "team", "team": "team",
    "why a grant": "why_grant", "why a grant what already exists": "why_grant",
    "why a grant: what already exists": "why_grant",
    "commitments": "commitments",
    "milestones": "milestones", "milestones (draft)": "milestones",
    "draft milestones": "milestones", "milestone plan": "milestones",
    # the 2026-09 board format folded these into In scope (a second section
    # for the same key is appended under its old heading in bold)
    "what this actually pays for": "in_scope", "what this rfp actually pays for": "in_scope",
    "what this grant actually pays for": "in_scope", "what this pays for": "in_scope",
}
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
HEDGES = re.compile(r"\bas needed\b|\bwhere appropriate\b", re.I)


def heading_key(raw, itype):
    n = re.sub(r"[*_`#]", "", str(raw)).lower()
    n = re.sub(r"\s+", " ", n).strip().rstrip(":.")
    if n == "what already exists":
        return "why_grant" if itype == "grant" else "existing"
    if n in ("the recipient", "recipient team and why them"):
        return "team" if itype == "grant" else "who"
    return ALIASES.get(n)


# ---------------------------------------------------------------- amounts
def parse_amount(raw):
    """One reader for every money field. "150,000" and "150.000" are 150000;
    "150,00" and "150.00" are 150; with mixed separators the last one is the
    decimal point. Anything else (currency symbols, words) is dropped first;
    a value with no digits is 0."""
    s = re.sub(r"[^0-9.,]", "", str(raw or ""))
    if not s:
        return 0.0
    last = max(s.rfind("."), s.rfind(","))
    try:
        if last < 0:
            n = float(s)
        elif re.fullmatch(r"\d{1,2}", s[last + 1:]):
            n = float(re.sub(r"[.,]", "", s[:last]) + "." + s[last + 1:])
        else:
            n = float(re.sub(r"[.,]", "", s))
    except ValueError:
        return 0.0
    return n if n == n and n != float("inf") else 0.0


def usd(n):
    n = float(n or 0)
    if abs(n % 1) > 0.004:
        return "${:,.2f}".format(n)
    return "${:,.0f}".format(n)


# ---------------------------------------------------------------- splitter
def row_from_heading(s):
    """'### Agreed standard - $50,000 (adoption)' -> a milestone row. A leading
    'A - ' from the old format is accepted and dropped."""
    row = {"name": "", "amount": 0.0, "adoption": False, "done": False,
           "link": "", "month": "", "criteria": []}
    t = str(s).strip()
    if re.search(r"\(adoption( milestone)?\)", t, re.I):
        row["adoption"] = True
        t = re.sub(r"\(adoption( milestone)?\)", "", t, flags=re.I).strip()
    if re.search(r"\(done\)", t, re.I):
        row["done"] = True
        t = re.sub(r"\(done\)", "", t, flags=re.I).strip()
    t = re.sub(r"[*_`]", "", t).strip()
    parts = re.split(r"\s+-\s+", t)
    if len(parts) >= 3 and len(parts[0].strip()) <= 3:
        row["amount"] = parse_amount(parts[-1])
        row["name"] = " - ".join(parts[1:-1]).strip()
    elif len(parts) >= 2 and parse_amount(parts[-1]) > 0:
        row["amount"] = parse_amount(parts[-1])
        row["name"] = " - ".join(parts[:-1]).strip()
    else:
        row["name"] = t
    return row


def parse_milestones(lines):
    """Milestone headings (### or deeper) become rows; bullet lines under them
    become criteria. Returns (rows, preamble_text)."""
    rows, cur, preamble = [], None, []
    for line in lines:
        h = re.match(r"^#{2,6}\s+(.+?)\s*#*\s*$", line)
        if h:
            cur = row_from_heading(h.group(1))
            rows.append(cur)
            continue
        t = line.strip()
        if not t:
            continue
        if cur is None:
            preamble.append(line)
            continue
        mm = re.match(r"^target month:\s*(\d{4}-\d{2})\b", t, re.I)
        if mm:
            cur["month"] = mm.group(1)
            continue
        dl = re.match(r"^delivered:\s*<?([^\s>]+)>?", t, re.I)
        if dl:
            cur["link"] = dl.group(1)
            continue
        crit = re.sub(r"^[-*+]\s+", "", t)
        crit = re.sub(r"^\d+[.)]\s+", "", crit)
        crit = re.sub(r"^\[[ xX]\]\s*", "", crit).strip()
        if crit:
            cur["criteria"].append(crit)
    return rows, "\n".join(preamble).strip()


def parse_backers(text):
    """'Org | $20,000 | https://...' lines -> backer rows (no logo: a pasted
    draft never carries one, the proposer uploads the file)."""
    out = []
    for line in str(text or "").split("\n"):
        line = re.sub(r"^[-*+]\s+", "", line).strip()
        if line.find("|") <= 0:
            continue
        p = line.split("|")
        out.append({"org": p[0].strip(), "amount": parse_amount(p[1] if len(p) > 1 else ""),
                    "url": (p[2].strip() if len(p) > 2 else "")})
    return out


def split_draft(text, itype):
    """One pasted document -> {"page": {...}, "fields": {...}, "milestones":
    [...], "unsorted": str}. Mirrors splitDraft() in the prototype."""
    out = {"page": {}, "fields": {}, "milestones": [], "unsorted": ""}
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    buckets, ms_lines, unsorted, cur = {}, [], [], None
    for line in lines:
        h = HEADING_RE.match(line)
        if h:
            level, name = len(h.group(1)), h.group(2)
            if level == 1 and not out["page"].get("title"):
                out["page"]["title"] = re.sub(r"^\s*(rfp|grant)\s*:\s*", "", name, flags=re.I).strip()
                cur = None
                continue
            if cur == "milestones" and level >= 3:
                ms_lines.append(line)
                continue
            key = heading_key(name, itype)
            if key:
                cur = key
                if buckets.get(key) and key != "milestones":  # second section, same field
                    buckets[key] += ["", "**%s**" % name.strip()]
                buckets.setdefault(key, [])
                continue
            if cur and cur not in ("milestones", "unsorted") and level >= 3:
                buckets[cur].append("**" + name + "**")
                continue
            cur = "unsorted"
            unsorted.append(line)
            continue
        if cur == "milestones":
            ms_lines.append(line)
        elif cur and cur != "unsorted":
            buckets[cur].append(line)
        else:
            unsorted.append(line)
    for k, v in buckets.items():
        if k == "milestones":  # its lines went to ms_lines
            continue
        t = re.sub(r"\n{3,}", "\n\n", "\n".join(v)).strip()
        if k in PAGE_KEYS:
            out["page"][k] = t
        else:
            out["fields"][k] = t
    rows, preamble = parse_milestones(ms_lines)
    out["milestones"] = rows
    if preamble:
        unsorted.append(preamble)
    out["unsorted"] = re.sub(r"\n{3,}", "\n\n", "\n".join(unsorted)).strip()
    return out


def strip_inline_headings(text):
    """No heading is allowed inside a field: a '### Foo' line becomes '**Foo**'."""
    out = []
    for line in str(text or "").replace("\r\n", "\n").split("\n"):
        h = HEADING_RE.match(line)
        out.append("**" + h.group(2).strip() + "**" if h else line)
    return "\n".join(out).strip()


# ---------------------------------------------------------------- checks
def adoption_floor(goal):
    """A third of the goal, and at least $100,000 once the goal reaches $300,000."""
    goal = float(goal or 0)
    floor = goal / 3.0
    if goal >= 300000:
        floor = max(floor, 100000.0)
    return floor


def check_submission(itype, topup, page, fields, milestones, backers):
    """The same rules the form runs, on the server. Returns (errors, warnings),
    each a list of {"field": <form field name>, "msg": str}. Errors block."""
    errs, warns = [], []

    def err(f, m):
        errs.append({"field": f, "msg": m})

    def warn(f, m):
        warns.append({"field": f, "msg": m})

    if len((page.get("title") or "").strip()) < 8:
        err("title", "Give the initiative a title (at least 8 characters).")
    if len((page.get("summary") or "").strip()) < 40:
        err("summary", "Describe the initiative in at least 40 characters.")
    goal = float(page.get("goal") or 0)
    if not (0 < goal <= 100_000_000):
        err("goal", "Enter the funding goal in USD, one flat number.")
    if not page.get("duration"):
        err("duration_months", "Enter the number of months to the last milestone.")
    if itype == "grant" and not (page.get("recipient") or "").strip():
        err("recipient_team", "Name the team that receives this grant.")
    for key in SECTIONS[itype]:
        if not (fields.get(key) or "").strip():
            err(key, "%s is required. Answer the question above." % FIELDS[key]["heading"])
    if len((page.get("funders") or "").strip()) < 10:
        err("funders", "Name at least one funder, one per line. Private, never published.")
    if not (page.get("contact") or "").strip():
        err("contact", "An email or handle, so we can ask about this submission.")

    for i, b in enumerate(backers):
        if b.get("org") and float(b.get("amount") or 0) <= 0:
            err("bk_amount_%d" % i, "Add what %s committed, or remove the row." % b["org"])
        if not b.get("org") and float(b.get("amount") or 0) > 0:
            err("bk_org_%d" % i, "Name the organization that committed this amount, or remove the row.")
    live = [b for b in backers if b.get("org") or float(b.get("amount") or 0) > 0]
    if topup and not live:
        warn("backers", "A top-up says the work is already funded by someone else. List that backer "
                        "so the header can show the amount and the logo.")

    if not milestones:
        err("milestones", "Add at least one milestone.")
    total = 0.0
    adoption = 0.0
    for i, m in enumerate(milestones):
        L = "Milestone %s" % chr(65 + i % 26)
        amt = float(m.get("amount") or 0)
        total += amt
        if m.get("adoption"):
            adoption += amt
        if not (m.get("name") or "").strip():
            err("ms_%d_name" % i, "%s: name this milestone." % L)
        if amt <= 0:
            err("ms_%d_amount" % i, "%s: enter what this milestone pays." % L)
        crits = [c for c in m.get("criteria") or [] if str(c).strip()]
        if not crits:
            err("ms_%d_crit" % i, "%s: write at least one criterion a reviewer can check." % L)
        if topup and m.get("done") and not (m.get("link") or "").strip():
            warn("ms_%d_link" % i, "%s is marked done with no link to the delivered work." % L)
        if topup and not m.get("done") and not (m.get("month") or "").strip():
            warn("ms_%d_month" % i, "%s has no target month. Every remaining milestone needs one." % L)
        for j, c in enumerate(crits):
            reasons = []
            if "[" in c:
                reasons.append("an unresolved bracket")
            if re.search(r"\bTBD\b", c, re.I):
                reasons.append("TBD")
            if re.search(r"PLACEHOLDER", c, re.I):
                reasons.append("PLACEHOLDER")
            if re.search(r"\d+\s*-\s*\d+", c):
                reasons.append("a range, pick the floor")
            if HEDGES.search(c):
                reasons.append("a hedge")
            if reasons:
                warn("ms_%d_c%d" % (i, j), "%s, not checkable yet: %s." % (L, ", ".join(reasons)))

    if milestones and goal > 0 and round(total) != round(goal):
        err("goal", "Milestone amounts total %s, the funding goal is %s. Change one of them."
            % (usd(total), usd(goal)))
    exempt = bool(topup and milestones and all(m.get("done") for m in milestones))
    if goal > 0 and milestones and not exempt:
        floor = adoption_floor(goal)
        if adoption == 0:
            err("milestones", "No milestone is an adoption milestone. Flag at least one, worth %s or more."
                % usd(floor))
        elif adoption < floor:
            err("milestones", "Adoption milestones carry %s, which is %d%% of the goal. Raise them to at least %s."
                % (usd(adoption), round(100 * adoption / goal), usd(floor)))
    return errs, warns


def body_key(fields, milestones):
    """The duplicate check compares the concatenated section text plus the
    milestone names and criteria, whitespace-normalized."""
    parts = [(fields.get(k) or "") for k in SECTION_KEYS]
    for m in milestones or []:
        parts.append(m.get("name") or "")
        parts.extend(m.get("criteria") or [])
    return re.sub(r"\s+", " ", "\n".join(parts)).strip().lower()


def milestones_to_json(rows):
    return json.dumps([{"name": r.get("name", ""), "amount": float(r.get("amount") or 0),
                        "adoption": bool(r.get("adoption")), "done": bool(r.get("done")),
                        "link": r.get("link", ""), "month": r.get("month", ""),
                        "criteria": [c for c in (r.get("criteria") or []) if str(c).strip()]}
                       for r in rows])


def milestones_from_json(s):
    try:
        rows = json.loads(s or "[]")
    except ValueError:
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        out.append({"name": str(r.get("name") or "")[:200], "amount": parse_amount(r.get("amount")),
                    "adoption": bool(r.get("adoption")), "done": bool(r.get("done")),
                    "link": str(r.get("link") or "")[:300], "month": str(r.get("month") or "")[:7],
                    "criteria": [str(c)[:500] for c in (r.get("criteria") or []) if str(c).strip()][:40]})
    return out[:40]


def render_milestones_md(rows, topup=False):
    """The page markdown for structured milestones: '### A - Name - $50,000'
    with a checkbox list, target months on top-ups, done rows checked with
    their link. Rendered by the same md filter as everything else."""
    out = []
    for i, m in enumerate(rows):
        head = "### %s - %s - %s" % (chr(65 + i % 26), m.get("name") or "Unnamed", usd(m.get("amount") or 0))
        if m.get("adoption"):
            head += " (adoption milestone)"
        if topup and m.get("done"):
            head += " (done)"
        out.append(head)
        out.append("")
        if topup and not m.get("done") and m.get("month"):
            out.append("Target month: %s" % m["month"])
            out.append("")
        box = "[x]" if (topup and m.get("done")) else "[ ]"
        for c in m.get("criteria") or []:
            out.append("- %s %s" % (box, c))
        if topup and m.get("done") and m.get("link"):
            out.append("")
            out.append("Delivered: <%s>" % m["link"])
        out.append("")
    return "\n".join(out).strip()


def minimal_submission(goal):
    """The smallest section + milestone payload that passes check_submission
    for either type: every section filled, one adoption milestone worth the
    goal. The spec of "what a valid post looks like", used by the tests."""
    out = {k: "Answered." for k in SECTION_KEYS}
    out["milestones_json"] = milestones_to_json([{"name": "Delivered", "amount": float(goal),
                                                  "adoption": True, "criteria": ["Merged."]}])
    return out


def milestones_to_md(rows):
    """The paste/edit format (what the guide asks for), the inverse of
    parse_milestones: '### Name - $50,000 (adoption)', bullets, Target month,
    Delivered. The admin edits milestones in this shape."""
    out = []
    for m in rows:
        head = "### %s - %s" % (m.get("name") or "Unnamed", usd(m.get("amount") or 0))
        if m.get("adoption"):
            head += " (adoption)"
        if m.get("done"):
            head += " (done)"
        out.append(head)
        if m.get("month"):
            out.append("Target month: %s" % m["month"])
        if m.get("link"):
            out.append("Delivered: %s" % m["link"])
        for c in m.get("criteria") or []:
            out.append("- %s" % c)
        out.append("")
    return "\n".join(out).strip()


# ---------------------------------------------------------------- migration 2
def convert_legacy(row):
    """Split a legacy `details` body into the structured columns. Returns
    (fields, reasons): fields is the update dict when every required section
    and the milestones parse and the sums match, else None; reasons lists
    what stopped it (or what changes, on success). Never writes."""
    itype = "grant" if row["type"] == "grant" else "rfp"
    topup = bool(itype == "grant" and row["topup"])
    res = split_draft(row["details"] or "", itype)
    reasons = []
    missing = [FIELDS[k]["heading"] for k in SECTIONS[itype] if not (res["fields"].get(k) or "").strip()]
    if missing:
        reasons.append("missing: " + ", ".join(missing))
    rows = res["milestones"]
    if not rows:
        reasons.append("no milestone headings found")
    bad = [m["name"] for m in rows if not m["criteria"] or m["amount"] <= 0]
    if bad:
        reasons.append("milestones without amount or criteria: " + ", ".join(bad))
    goal = float(row["funding_goal_usd"] or 0)
    total = sum(m["amount"] for m in rows)
    if rows and round(total) != round(goal):
        reasons.append("milestones total %s, goal is %s" % (usd(total), usd(goal)))
    extra = [k for k in res["fields"] if k not in SECTIONS[itype]]
    if extra:
        reasons.append("sections of the other type: " + ", ".join(FIELDS[k]["heading"] for k in extra))
    if res["unsorted"]:
        reasons.append("unsorted text: " + res["unsorted"][:80].replace("\n", " / "))
    if reasons:
        return None, reasons
    fields = {k: res["fields"][k] for k in SECTIONS[itype]}
    fields["milestones_json"] = milestones_to_json(rows)
    fields["links"] = res["page"].get("links", "")
    fields["structured"] = 1
    what = ["%d sections" % len(SECTIONS[itype]), "%d milestones" % len(rows)]
    if fields["links"]:
        what.append("links")
    return fields, what
