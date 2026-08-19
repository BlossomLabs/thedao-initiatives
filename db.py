"""SQLite storage. stdlib sqlite3, WAL mode, prepared statements throughout."""
import json
import re
import secrets
import sqlite3
import time

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS rfps(
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  discourse_url TEXT DEFAULT '',
  funding_goal_usd REAL NOT NULL DEFAULT 0 CHECK(funding_goal_usd >= 0),
  payout_addresses TEXT NOT NULL DEFAULT '[]',
  contact TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','archived')),
  featured INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE TABLE IF NOT EXISTS pledges(
  id INTEGER PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES rfps(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  amount_usd REAL NOT NULL CHECK(amount_usd > 0),
  status TEXT NOT NULL DEFAULT 'pledged'
    CHECK(status IN ('pledged','received','withdrawn')),
  note TEXT DEFAULT '',
  url TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS donations(
  id INTEGER PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES rfps(id) ON DELETE CASCADE,
  token_symbol TEXT NOT NULL DEFAULT '',
  token_address TEXT NOT NULL DEFAULT '',
  amount_raw TEXT NOT NULL DEFAULT '0',
  amount REAL NOT NULL DEFAULT 0,
  donor TEXT DEFAULT '',
  tx_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','failed')),
  detail TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES rfps(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id),
  type TEXT NOT NULL CHECK(type IN ('suggestion','question','other')),
  topic TEXT DEFAULT '',
  body TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  roles TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published'
    CHECK(status IN ('published','held','discarded')),
  answered INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  votes INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT DEFAULT '',
  claim_token TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_rfp ON comments(rfp_id, status);
CREATE TABLE IF NOT EXISTS comment_votes(
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(comment_id, address)
);
CREATE TABLE IF NOT EXISTS comment_vote_ts(
  comment_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  last_ts INTEGER NOT NULL,
  UNIQUE(comment_id, address)
);
CREATE INDEX IF NOT EXISTS idx_rfps_status ON rfps(status);
CREATE INDEX IF NOT EXISTS idx_pledges_rfp ON pledges(rfp_id);
CREATE INDEX IF NOT EXISTS idx_donations_rfp ON donations(rfp_id);
CREATE TABLE IF NOT EXISTS nicknames(
  address TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  pfp TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nick_lower ON nicknames(lower(nickname)) WHERE nickname != '';
"""


def connect():
    con = sqlite3.connect(config.DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def get_nickname(address):
    """The nickname registered for an address (as stored), or None."""
    if not address:
        return None
    con = connect()
    try:
        r = con.execute("SELECT nickname FROM nicknames WHERE address=?",
                        (address.lower(),)).fetchone()
        return r["nickname"] if r else None
    finally:
        con.close()


def nickname_owner(nickname):
    """The address currently holding this nickname (case-insensitive), or None."""
    con = connect()
    try:
        r = con.execute("SELECT address FROM nicknames WHERE lower(nickname)=lower(?)",
                        (nickname,)).fetchone()
        return r["address"] if r else None
    finally:
        con.close()


def set_nickname(address, nickname):
    """Upsert an address's nickname. Uniqueness (lower) is enforced by index;
    callers should check nickname_owner first for a friendly error."""
    con = connect()
    try:
        with con:
            con.execute(
                "INSERT INTO nicknames(address, nickname, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(address) DO UPDATE SET nickname=excluded.nickname, "
                "updated_at=excluded.updated_at",
                (address.lower(), nickname, int(time.time())))
    finally:
        con.close()


def get_profile(address):
    """{'nickname': str|None, 'pfp': str} for an address ('' pfp = default)."""
    if not address:
        return {"nickname": None, "pfp": ""}
    con = connect()
    try:
        r = con.execute("SELECT nickname, pfp FROM nicknames WHERE address=?",
                        (address.lower(),)).fetchone()
        if not r:
            return {"nickname": None, "pfp": ""}
        return {"nickname": r["nickname"] or None, "pfp": r["pfp"] or ""}
    finally:
        con.close()


def set_pfp(address, pfp):
    """Set an address's profile picture (a preset id like 'preset:3' or an
    uploaded ref like 'upload:<file>'). Creates a nickname-less row if needed."""
    con = connect()
    try:
        with con:
            con.execute(
                "INSERT INTO nicknames(address, nickname, pfp, updated_at) "
                "VALUES(?,'',?,?) ON CONFLICT(address) DO UPDATE SET "
                "pfp=excluded.pfp, updated_at=excluded.updated_at",
                (address.lower(), pfp, int(time.time())))
    finally:
        con.close()


def init():
    con = connect()
    with con:
        con.executescript(SCHEMA)
        # migrations for columns added after v1
        cols = {r["name"] for r in con.execute("PRAGMA table_info(rfps)")}
        if "details" not in cols:
            con.execute("ALTER TABLE rfps ADD COLUMN details TEXT DEFAULT ''")
        if "safe_address" not in cols:
            con.execute("ALTER TABLE rfps ADD COLUMN safe_address TEXT DEFAULT ''")
        pcols = {r["name"] for r in con.execute("PRAGMA table_info(pledges)")}
        if "logo" not in pcols:
            con.execute("ALTER TABLE pledges ADD COLUMN logo TEXT DEFAULT ''")
        # Directional votes: +1 up / -1 down. Existing rows were all upvotes.
        vcols = {r["name"] for r in con.execute("PRAGMA table_info(comment_votes)")}
        if "value" not in vcols:
            con.execute("ALTER TABLE comment_votes ADD COLUMN value "
                        "INTEGER NOT NULL DEFAULT 1")
        # Featured ordering: the most-recently-featured comment sorts to the very
        # top, above earlier-featured ones. 0 = not featured; set to now() when an
        # admin features it, cleared on unfeature.
        ccols = {r["name"] for r in con.execute("PRAGMA table_info(comments)")}
        if "featured_at" not in ccols:
            con.execute("ALTER TABLE comments ADD COLUMN featured_at "
                        "INTEGER NOT NULL DEFAULT 0")
        # Profile pictures live alongside nicknames. Allow a profile row with a
        # pfp but no nickname, so the unique-nickname index goes partial.
        nick_cols = {r["name"] for r in con.execute("PRAGMA table_info(nicknames)")}
        if "pfp" not in nick_cols:
            con.execute("ALTER TABLE nicknames ADD COLUMN pfp TEXT NOT NULL "
                        "DEFAULT ''")
            con.execute("DROP INDEX IF EXISTS idx_nick_lower")
            con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_nick_lower "
                        "ON nicknames(lower(nickname)) WHERE nickname != ''")
        if "sort_rank" not in cols:
            con.execute("ALTER TABLE rfps ADD COLUMN sort_rank INTEGER")
        # Every listing is an "initiative" of one of two types: an RFP (open
        # competitive bid, no preset vendor) or a Grant (the proposing team
        # does the work). Existing rows default to 'rfp'; the three launch
        # listings that are really Grants are set once, here, when the column
        # first appears (idempotent: the guard is the column's absence).
        if "type" not in cols:
            con.execute("ALTER TABLE rfps ADD COLUMN type TEXT NOT NULL "
                        "DEFAULT 'rfp' CHECK(type IN ('rfp','grant'))")
            con.execute("UPDATE rfps SET type='grant' WHERE "
                        "title LIKE '%Vyper Compiler%' OR "
                        "title LIKE '%EIP Compliance%' OR "
                        "title LIKE '%PRSpec%'")
        # Donations key: one tx can legitimately fund several RFPs (a batch/
        # disperse that sends to multiple RFP Safes). Move from UNIQUE(tx_hash)
        # to UNIQUE(tx_hash, rfp_id). Per-Safe verification still gates each
        # credit, so a tx can only ever credit an RFP whose Safe it paid.
        idx = {r["name"] for r in con.execute("PRAGMA index_list(donations)")}
        if "idx_don_tx_rfp" not in idx:
            con.executescript("""
                CREATE TABLE donations_new(
                  id INTEGER PRIMARY KEY,
                  rfp_id INTEGER NOT NULL REFERENCES rfps(id) ON DELETE CASCADE,
                  token_symbol TEXT NOT NULL DEFAULT '',
                  token_address TEXT NOT NULL DEFAULT '',
                  amount_raw TEXT NOT NULL DEFAULT '0',
                  amount REAL NOT NULL DEFAULT 0,
                  donor TEXT DEFAULT '',
                  tx_hash TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','confirmed','failed')),
                  detail TEXT DEFAULT '',
                  created_at INTEGER NOT NULL,
                  confirmed_at INTEGER
                );
                INSERT INTO donations_new SELECT id,rfp_id,token_symbol,
                  token_address,amount_raw,amount,donor,tx_hash,status,detail,
                  created_at,confirmed_at FROM donations;
                DROP TABLE donations;
                ALTER TABLE donations_new RENAME TO donations;
                CREATE UNIQUE INDEX idx_don_tx_rfp ON donations(tx_hash, rfp_id);
                CREATE INDEX idx_donations_rfp ON donations(rfp_id);
            """)
    con.close()


def now():
    return int(time.time())


def slugify(title, con=None):
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "rfp"
    slug, n = base, 2
    owned = con is None
    if owned:
        con = connect()
    try:
        while con.execute("SELECT 1 FROM rfps WHERE slug=?", (slug,)).fetchone():
            slug = "%s-%d" % (base, n)
            n += 1
    finally:
        if owned:
            con.close()
    return slug


# ---------------------------------------------------------------- rfps

def create_rfp(title, summary, discourse_url, goal, payout_addresses,
               contact, status="pending", details="", type="rfp"):
    con = connect()
    try:
        # Retry on the rare race where two concurrent submits pick the same
        # slug before either commits (UNIQUE(slug) raises on the loser).
        for attempt in range(5):
            slug = slugify(title, con)
            if attempt:
                slug = "%s-%d" % (slug, secrets.randbelow(9000) + 1000)
            try:
                with con:
                    cur = con.execute(
                        "INSERT INTO rfps(slug,title,summary,discourse_url,"
                        "funding_goal_usd,payout_addresses,contact,status,"
                        "created_at,approved_at,details,type) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                        (slug, title, summary, discourse_url, goal,
                         json.dumps(payout_addresses), contact, status, now(),
                         now() if status == "approved" else None, details,
                         type))
                    return cur.lastrowid, slug
            except sqlite3.IntegrityError:
                if attempt == 4:
                    raise
    finally:
        con.close()


def rfp_by_slug(slug):
    con = connect()
    try:
        return con.execute("SELECT * FROM rfps WHERE slug=?", (slug,)).fetchone()
    finally:
        con.close()


def rfp_by_id(rfp_id):
    con = connect()
    try:
        return con.execute("SELECT * FROM rfps WHERE id=?", (rfp_id,)).fetchone()
    finally:
        con.close()


def upsert_rfp_content(slug, title, summary, details, goal, discourse_url="",
                       status="approved", sort_rank=None, type="rfp"):
    """Create or update an RFP from a content file (content/rfps/<slug>.md).

    Content files own the words and the goal; the admin panel owns the
    lifecycle. So on update this NEVER touches status, safe_address, or any
    money data — an edited file can't unpublish an RFP or detach its Safe.
    Returns "created" or "updated".
    """
    existing = rfp_by_slug(slug)
    if existing:
        fields = {"title": title, "summary": summary, "details": details,
                  "funding_goal_usd": goal, "discourse_url": discourse_url,
                  "type": type}
        if sort_rank is not None:
            fields["sort_rank"] = sort_rank
        update_rfp(existing["id"], **fields)
        return "updated"
    con = connect()
    try:
        with con:
            con.execute(
                "INSERT INTO rfps(slug,title,summary,discourse_url,"
                "funding_goal_usd,payout_addresses,contact,status,created_at,"
                "approved_at,details,sort_rank,type) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (slug, title, summary, discourse_url, goal, "[]", "",
                 status, now(), now() if status == "approved" else None,
                 details, sort_rank, type))
        return "created"
    finally:
        con.close()


def rfp_by_safe_address(address):
    """The RFP that owns this Safe address, if any (case-insensitive).
    Used to keep every Safe bound to exactly one RFP."""
    con = connect()
    try:
        return con.execute(
            "SELECT * FROM rfps WHERE lower(safe_address)=lower(?)",
            (address,)).fetchone()
    finally:
        con.close()


def list_rfps(statuses=("approved",)):
    con = connect()
    try:
        q = ",".join("?" * len(statuses))
        # Board order is decided in app.order_cards (admin pin, then amount
        # raised); here just return newest-first for a stable base order.
        return con.execute(
            "SELECT * FROM rfps WHERE status IN (%s) "
            "ORDER BY created_at DESC" % q, statuses).fetchall()
    finally:
        con.close()


def update_rfp(rfp_id, **fields):
    allowed = {"title", "summary", "details", "discourse_url",
               "funding_goal_usd", "payout_addresses", "contact", "status",
               "approved_at", "safe_address", "sort_rank", "type"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            raise ValueError("field not allowed: %s" % k)
        sets.append("%s=?" % k)
        vals.append(v)
    vals.append(rfp_id)
    con = connect()
    try:
        with con:
            con.execute("UPDATE rfps SET %s WHERE id=?" % ",".join(sets), vals)
    finally:
        con.close()


# ---------------------------------------------------------------- pledges

def add_pledge(rfp_id, company, amount_usd, status, note, url, logo=""):
    con = connect()
    try:
        with con:
            con.execute(
                "INSERT INTO pledges(rfp_id,company,amount_usd,status,note,"
                "url,logo,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (rfp_id, company, amount_usd, status, note, url, logo, now()))
    finally:
        con.close()


def pledges_for(rfp_id, include_withdrawn=False):
    con = connect()
    try:
        if include_withdrawn:
            return con.execute(
                "SELECT * FROM pledges WHERE rfp_id=? ORDER BY amount_usd DESC",
                (rfp_id,)).fetchall()
        return con.execute(
            "SELECT * FROM pledges WHERE rfp_id=? AND status!='withdrawn' "
            "ORDER BY amount_usd DESC", (rfp_id,)).fetchall()
    finally:
        con.close()


def update_pledge(pledge_id, status):
    con = connect()
    try:
        with con:
            con.execute("UPDATE pledges SET status=? WHERE id=?",
                        (status, pledge_id))
    finally:
        con.close()


def delete_pledge(pledge_id):
    con = connect()
    try:
        with con:
            con.execute("DELETE FROM pledges WHERE id=?", (pledge_id,))
    finally:
        con.close()


# ---------------------------------------------------------------- donations

def record_donation(rfp_id, tx_hash, verification):
    """Insert or update a donation row from a chain verification result.

    Status mapping: confirmed = verified transfer to the RFP's Safe; failed = mined
    but wrong (reverted / wrong token / wrong recipient); pending = in the
    mempool OR not visible to our RPC yet (fresh txs propagate slowly).
    """
    v = verification
    if v["ok"]:
        status = "confirmed"
    elif v["found"] and not v["pending"]:
        status = "failed"
    else:
        status = "pending"
    con = connect()
    try:
        with con:
            existing = con.execute(
                "SELECT id, status FROM donations WHERE tx_hash=? AND rfp_id=?",
                (tx_hash, rfp_id)).fetchone()
            if existing:
                if existing["status"] == "confirmed":
                    return existing["id"], "already-confirmed"
                con.execute(
                    "UPDATE donations SET token_symbol=?,token_address=?,"
                    "amount_raw=?,amount=?,donor=?,status=?,detail=?,"
                    "confirmed_at=? WHERE id=?",
                    (v["token_symbol"], v["token_address"], v["amount_raw"],
                     v.get("amount_usd", v["amount"]), v["donor"], status,
                     v["detail"],
                     now() if status == "confirmed" else None,
                     existing["id"]))
                return existing["id"], status
            try:
                cur = con.execute(
                    "INSERT INTO donations(rfp_id,token_symbol,token_address,"
                    "amount_raw,amount,donor,tx_hash,status,detail,created_at,"
                    "confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (rfp_id, v["token_symbol"], v["token_address"],
                     v["amount_raw"], v.get("amount_usd", v["amount"]),
                     v["donor"], tx_hash, status,
                     v["detail"], now(),
                     now() if status == "confirmed" else None))
                return cur.lastrowid, status
            except sqlite3.IntegrityError:
                # Concurrent insert of this (tx_hash, rfp_id). Re-read and treat
                # it as existing (idempotent, no double-credit).
                row = con.execute(
                    "SELECT id, status FROM donations WHERE tx_hash=? "
                    "AND rfp_id=?", (tx_hash, rfp_id)).fetchone()
                if row:
                    return row["id"], row["status"]
                raise
    finally:
        con.close()


def donations_for(rfp_id, only_confirmed=True):
    con = connect()
    try:
        if only_confirmed:
            return con.execute(
                "SELECT * FROM donations WHERE rfp_id=? AND status='confirmed' "
                "ORDER BY confirmed_at DESC", (rfp_id,)).fetchall()
        return con.execute(
            "SELECT * FROM donations WHERE rfp_id=? ORDER BY created_at DESC",
            (rfp_id,)).fetchall()
    finally:
        con.close()


def donation_by_hash(tx_hash):
    """Any donation row for this tx (a tx may now credit multiple RFPs)."""
    con = connect()
    try:
        return con.execute("SELECT * FROM donations WHERE tx_hash=? "
                           "ORDER BY id LIMIT 1", (tx_hash,)).fetchone()
    finally:
        con.close()


def donation_by_hash_rfp(tx_hash, rfp_id):
    con = connect()
    try:
        return con.execute(
            "SELECT * FROM donations WHERE tx_hash=? AND rfp_id=?",
            (tx_hash, rfp_id)).fetchone()
    finally:
        con.close()


def pending_donations():
    con = connect()
    try:
        return con.execute(
            "SELECT * FROM donations WHERE status='pending'").fetchall()
    finally:
        con.close()


# ---------------------------------------------------------------- totals

def funding_summary(rfp_id):
    con = connect()
    try:
        pledged = con.execute(
            "SELECT COALESCE(SUM(amount_usd),0) s FROM pledges "
            "WHERE rfp_id=? AND status!='withdrawn'", (rfp_id,)).fetchone()["s"]
        donated = con.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM donations "
            "WHERE rfp_id=? AND status='confirmed'", (rfp_id,)).fetchone()["s"]
        return {"pledged": pledged, "donated": donated,
                "total": pledged + donated}
    finally:
        con.close()


# ---------------------------------------------------------------- meta

def meta_get(key, default=None):
    con = connect()
    try:
        row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default
    finally:
        con.close()


def meta_set(key, value):
    con = connect()
    try:
        with con:
            con.execute(
                "INSERT INTO meta(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value))
    finally:
        con.close()


# ---------------------------------------------------------- community Q&A

def create_comment(rfp_id, parent_id, ctype, topic, body, display_name,
                   email, address, roles, status, ai_summary="",
                   start_vote=False):
    """Insert an entry or reply. Returns (comment_id, claim_token).

    start_vote: the author is vote-eligible, so the entry starts at 1 vote
    (their own, recorded in comment_votes so the toggle works, spec §4).
    """
    token = secrets.token_hex(16)
    con = connect()
    with con:
        cur = con.execute(
            "INSERT INTO comments(rfp_id,parent_id,type,topic,body,"
            "display_name,email,address,roles,status,ai_summary,claim_token,"
            "created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (rfp_id, parent_id, ctype, topic, body, display_name, email,
             address, roles, status, ai_summary, token, now()))
        cid = cur.lastrowid
        if start_vote and address and parent_id is None:
            con.execute("INSERT INTO comment_votes(comment_id,address,"
                        "created_at) VALUES(?,?,?)", (cid, address, now()))
            con.execute("UPDATE comments SET votes=1 WHERE id=?", (cid,))
    con.close()
    return cid, token


def comment_by_id(comment_id):
    con = connect()
    row = con.execute("SELECT * FROM comments WHERE id=?",
                      (comment_id,)).fetchone()
    con.close()
    return row


def comments_for_rfp(rfp_id):
    """Published entries + their replies for an initiative page."""
    con = connect()
    rows = con.execute(
        "SELECT * FROM comments WHERE rfp_id=? AND status='published' "
        "ORDER BY created_at", (rfp_id,)).fetchall()
    con.close()
    return rows


def comments_by_claim_tokens(tokens):
    """Author-only view (spec §10): each token unlocks exactly its own held
    entry, nothing else. Published/discarded rows are never returned here."""
    if not tokens:
        return []
    con = connect()
    q = ",".join("?" * len(tokens))
    rows = con.execute(
        "SELECT * FROM comments WHERE claim_token IN (%s) AND status='held'"
        % q, list(tokens)).fetchall()
    con.close()
    return rows


def comment_set(comment_id, **fields):
    allowed = {"status", "answered", "reviewed", "accepted", "featured",
               "featured_at", "ai_summary"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            raise ValueError("bad field %r" % k)
        sets.append("%s=?" % k)
        vals.append(v)
    vals.append(comment_id)
    con = connect()
    with con:
        con.execute("UPDATE comments SET %s WHERE id=?" % ",".join(sets), vals)
    con.close()


def set_vote(comment_id, address, value, sig_ts):
    """Set this address's vote to +1 (up) or -1 (down); clicking the same
    direction again clears it. Monotonic-timestamp guard: the signed ts must be
    strictly newer than the last vote action for (entry, address), so a replayed
    signature inside the 10-minute window cannot flip a vote back. Returns
    (ok, myvote, score) with myvote in {-1,0,1} and score = SUM(value) (net).
    ok False means the replay guard fired."""
    if value not in (1, -1):
        return False, 0, 0
    con = connect()
    with con:
        row = con.execute(
            "SELECT last_ts FROM comment_vote_ts WHERE comment_id=? AND "
            "address=?", (comment_id, address)).fetchone()
        if row and sig_ts <= row["last_ts"]:
            cur = con.execute("SELECT votes FROM comments WHERE id=?",
                              (comment_id,)).fetchone()
            stale_score = cur["votes"] if cur else 0
            mine = con.execute("SELECT value FROM comment_votes WHERE "
                               "comment_id=? AND address=?",
                               (comment_id, address)).fetchone()
            stale_my = mine["value"] if mine else 0
        else:
            stale_score = None
    if stale_score is not None:
        con.close()
        return False, stale_my, stale_score
    with con:
        con.execute(
            "INSERT INTO comment_vote_ts(comment_id,address,last_ts) "
            "VALUES(?,?,?) ON CONFLICT(comment_id,address) "
            "DO UPDATE SET last_ts=excluded.last_ts",
            (comment_id, address, sig_ts))
        existing = con.execute(
            "SELECT value FROM comment_votes WHERE comment_id=? AND address=?",
            (comment_id, address)).fetchone()
        if existing and existing["value"] == value:
            con.execute("DELETE FROM comment_votes WHERE comment_id=? AND "
                        "address=?", (comment_id, address))
            myvote = 0
        elif existing:
            con.execute("UPDATE comment_votes SET value=?, created_at=? WHERE "
                        "comment_id=? AND address=?",
                        (value, now(), comment_id, address))
            myvote = value
        else:
            con.execute("INSERT INTO comment_votes(comment_id,address,"
                        "created_at,value) VALUES(?,?,?,?)",
                        (comment_id, address, now(), value))
            myvote = value
        score = con.execute("SELECT COALESCE(SUM(value),0) s FROM "
                            "comment_votes WHERE comment_id=?",
                            (comment_id,)).fetchone()["s"]
        con.execute("UPDATE comments SET votes=? WHERE id=?", (score, comment_id))
    con.close()
    return True, myvote, score


def votes_by_address(rfp_id, address):
    """Map of {entry id: vote value +1/-1} for this address on this initiative."""
    con = connect()
    rows = con.execute(
        "SELECT v.comment_id, v.value FROM comment_votes v JOIN comments c ON "
        "c.id=v.comment_id WHERE c.rfp_id=? AND v.address=?",
        (rfp_id, address)).fetchall()
    con.close()
    return {r["comment_id"]: r["value"] for r in rows}


def add_report(comment_id):
    con = connect()
    with con:
        con.execute("UPDATE comments SET reports=reports+1 WHERE id=? AND "
                    "status='published'", (comment_id,))
    con.close()


def donation_total_for(rfp_id, address):
    """Confirmed USD total this address donated to THIS initiative (voting
    eligibility, spec §4). Donations to other initiatives grant nothing."""
    con = connect()
    row = con.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM donations WHERE rfp_id=? AND "
        "status='confirmed' AND LOWER(donor)=LOWER(?)",
        (rfp_id, address)).fetchone()
    con.close()
    return row["s"] or 0


def held_comments():
    con = connect()
    rows = con.execute(
        "SELECT c.*, r.slug, r.title FROM comments c JOIN rfps r ON "
        "r.id=c.rfp_id WHERE c.status='held' "
        "ORDER BY c.reports DESC, c.created_at").fetchall()
    con.close()
    return rows


def unanswered_questions():
    """Published questions with no role reply, oldest first (admin panel)."""
    con = connect()
    rows = con.execute(
        "SELECT c.*, r.slug, r.title FROM comments c JOIN rfps r ON "
        "r.id=c.rfp_id WHERE c.status='published' AND c.type='question' AND "
        "c.answered=0 AND c.parent_id IS NULL "
        "ORDER BY c.created_at").fetchall()
    con.close()
    return rows


def reported_comments():
    con = connect()
    rows = con.execute(
        "SELECT c.*, r.slug, r.title FROM comments c JOIN rfps r ON "
        "r.id=c.rfp_id WHERE c.status='published' AND c.reports>0 "
        "ORDER BY c.reports DESC, c.created_at").fetchall()
    con.close()
    return rows


def front_page_featured(limit=3):
    """Entries admin-featured for the front-page strip (featured=2)."""
    con = connect()
    rows = con.execute(
        "SELECT c.*, r.slug, r.title FROM comments c JOIN rfps r ON "
        "r.id=c.rfp_id WHERE c.status='published' AND c.featured=2 AND "
        "c.parent_id IS NULL AND r.status='approved' "
        "ORDER BY c.created_at DESC LIMIT ?",
        (limit,)).fetchall()
    con.close()
    return rows


def count_front_page_featured():
    con = connect()
    n = con.execute("SELECT COUNT(*) c FROM comments WHERE featured=2 AND "
                    "status='published'").fetchone()["c"]
    con.close()
    return n
