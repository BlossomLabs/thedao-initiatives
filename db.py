"""SQLite storage. stdlib sqlite3, WAL mode, prepared statements throughout."""
import json
import re
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
CREATE INDEX IF NOT EXISTS idx_rfps_status ON rfps(status);
CREATE INDEX IF NOT EXISTS idx_pledges_rfp ON pledges(rfp_id);
CREATE INDEX IF NOT EXISTS idx_donations_rfp ON donations(rfp_id);
"""


def connect():
    con = sqlite3.connect(config.DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init():
    con = connect()
    with con:
        con.executescript(SCHEMA)
        # migrations for columns added after v1
        cols = {r["name"] for r in con.execute("PRAGMA table_info(rfps)")}
        if "details" not in cols:
            con.execute("ALTER TABLE rfps ADD COLUMN details TEXT DEFAULT ''")
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
               contact, status="pending"):
    con = connect()
    try:
        with con:
            slug = slugify(title, con)
            cur = con.execute(
                "INSERT INTO rfps(slug,title,summary,discourse_url,"
                "funding_goal_usd,payout_addresses,contact,status,created_at,"
                "approved_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (slug, title, summary, discourse_url, goal,
                 json.dumps(payout_addresses), contact, status, now(),
                 now() if status == "approved" else None))
            return cur.lastrowid, slug
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


def list_rfps(statuses=("approved",)):
    con = connect()
    try:
        q = ",".join("?" * len(statuses))
        return con.execute(
            "SELECT * FROM rfps WHERE status IN (%s) "
            "ORDER BY featured DESC, created_at DESC" % q, statuses).fetchall()
    finally:
        con.close()


def update_rfp(rfp_id, **fields):
    allowed = {"title", "summary", "details", "discourse_url",
               "funding_goal_usd", "payout_addresses", "contact", "status",
               "featured", "approved_at"}
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

def add_pledge(rfp_id, company, amount_usd, status, note, url):
    con = connect()
    try:
        with con:
            con.execute(
                "INSERT INTO pledges(rfp_id,company,amount_usd,status,note,"
                "url,created_at) VALUES(?,?,?,?,?,?,?)",
                (rfp_id, company, amount_usd, status, note, url, now()))
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

    Status mapping: confirmed = verified transfer to treasury; failed = mined
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
                "SELECT id, rfp_id, status FROM donations WHERE tx_hash=?",
                (tx_hash,)).fetchone()
            if existing:
                if existing["status"] == "confirmed":
                    return existing["id"], "already-confirmed"
                con.execute(
                    "UPDATE donations SET token_symbol=?,token_address=?,"
                    "amount_raw=?,amount=?,donor=?,status=?,detail=?,"
                    "confirmed_at=? WHERE id=?",
                    (v["token_symbol"], v["token_address"], v["amount_raw"],
                     v["amount"], v["donor"], status, v["detail"],
                     now() if status == "confirmed" else None,
                     existing["id"]))
                return existing["id"], status
            cur = con.execute(
                "INSERT INTO donations(rfp_id,token_symbol,token_address,"
                "amount_raw,amount,donor,tx_hash,status,detail,created_at,"
                "confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (rfp_id, v["token_symbol"], v["token_address"],
                 v["amount_raw"], v["amount"], v["donor"], tx_hash, status,
                 v["detail"], now(),
                 now() if status == "confirmed" else None))
            return cur.lastrowid, status
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
    con = connect()
    try:
        return con.execute("SELECT * FROM donations WHERE tx_hash=?",
                           (tx_hash,)).fetchone()
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
