"""TheDAO Security Fund — RFP funding coordination app.

Public: browse RFPs, submit an RFP from a Discourse forum link, donate
mainnet stablecoins directly to an RFP (funds go to the configured treasury).
Admin: approve/reject submissions, manage company pledges, recheck donations.
"""
import hmac
import ipaddress
import json
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from functools import wraps

from flask import (Flask, abort, jsonify, redirect, render_template, request,
                   session, url_for)

import chain
import config
import db

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=64 * 1024,
)

db.init()

# ------------------------------------------------------------ chain state
# Treasury + token info verified at startup, refreshed periodically.

_state = {"treasury": None, "verified": False, "detail": "not yet resolved",
          "tokens": {}, "checked_at": 0}
_state_lock = threading.Lock()
CHAIN_REFRESH_SECS = 6 * 3600


def chain_state():
    with _state_lock:
        fresh = time.time() - _state["checked_at"] < CHAIN_REFRESH_SECS
        if fresh and _state["treasury"]:
            return dict(_state)
    treasury, verified, detail = None, False, ""
    tokens = {}
    try:
        treasury, verified, detail = chain.resolve_treasury()
        tokens = chain.verify_tokens()
    except Exception as e:  # RPC outage: keep last known state if any
        detail = "chain check failed: %s" % e
    with _state_lock:
        if treasury:
            _state.update(treasury=treasury, verified=verified, detail=detail,
                          tokens=tokens, checked_at=time.time())
        else:
            _state["detail"] = detail
            _state["checked_at"] = time.time() - CHAIN_REFRESH_SECS + 300
        return dict(_state)


def active_tokens(state):
    """Only tokens that passed live on-chain verification are offered."""
    return {sym: (t["address"], t["decimals"])
            for sym, t in state["tokens"].items() if t["ok"]}


# ------------------------------------------------------------ security bits

_buckets = defaultdict(deque)
_bucket_lock = threading.Lock()


def rate_limit(key, limit, window_secs):
    now = time.time()
    with _bucket_lock:
        q = _buckets[key]
        while q and q[0] < now - window_secs:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


def client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "?")\
        .split(",")[0].strip()


def csrf_token():
    if "_csrf" not in session:
        import secrets
        session["_csrf"] = secrets.token_hex(16)
    return session["_csrf"]


def check_csrf():
    tok = request.form.get("_csrf", "")
    if not (tok and hmac.compare_digest(tok, session.get("_csrf", "-"))):
        abort(400, "bad csrf token")


def same_origin_only():
    """For JSON endpoints: reject cross-site browser calls."""
    origin = request.headers.get("Origin")
    if origin:
        host = urllib.parse.urlsplit(origin).netloc
        if host != request.host:
            abort(403)


def admin_required(f):
    @wraps(f)
    def inner(*a, **kw):
        if not session.get("admin"):
            return redirect(url_for("admin_login"))
        return f(*a, **kw)
    return inner


@app.after_request
def harden(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; img-src 'self' data:; "
        "connect-src 'self'; frame-ancestors 'none'")
    return resp


@app.context_processor
def inject_globals():
    return {"csrf_token": csrf_token, "TOKENS": config.TOKENS}


# ------------------------------------------------------------ jinja filters

@app.template_filter("usd")
def usd(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "$0"
    if v >= 1000:
        return "${:,.0f}".format(v)
    return "${:,.2f}".format(v)


@app.template_filter("shortaddr")
def shortaddr(a):
    return (a[:6] + "…" + a[-4:]) if a and len(a) > 12 else (a or "")


@app.template_filter("dt")
def dt(ts):
    if not ts:
        return ""
    return time.strftime("%b %d, %Y", time.localtime(int(ts)))


# ------------------------------------------------------------ validation

MAX_TITLE = 140
MAX_SUMMARY = 4000
FORUM_HOST_RE = re.compile(r"^[a-z0-9.-]+$")


def _is_public_hostname(host):
    """SSRF guard: every resolved IP must be public."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False
    return True


def validate_forum_url(raw):
    """Accept an https link to a (Discourse) forum topic."""
    raw = (raw or "").strip()
    if not raw:
        return None, "A forum link is required."
    if len(raw) > 500:
        return None, "Link is too long."
    try:
        u = urllib.parse.urlsplit(raw)
    except ValueError:
        return None, "That does not look like a valid URL."
    if u.scheme != "https":
        return None, "The forum link must be https."
    host = (u.hostname or "").lower()
    if not host or not FORUM_HOST_RE.match(host) or "." not in host:
        return None, "That does not look like a valid forum host."
    if not _is_public_hostname(host):
        return None, "That forum host is not reachable."
    clean = urllib.parse.urlunsplit(("https", u.netloc, u.path, u.query, ""))
    return clean, None


def fetch_discourse_title(topic_url):
    """Best-effort: Discourse exposes topic JSON at <topic-url>.json."""
    try:
        u = urllib.parse.urlsplit(topic_url)
        json_url = urllib.parse.urlunsplit(
            ("https", u.netloc, u.path.rstrip("/") + ".json", "", ""))

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(
            json_url, headers={"User-Agent": "thedao-rfps/1.0",
                               "Accept": "application/json"})
        with opener.open(req, timeout=6) as resp:
            body = resp.read(512 * 1024)
        data = json.loads(body.decode("utf-8", "replace"))
        title = (data.get("title") or "").strip()
        return title[:MAX_TITLE] if title else None
    except Exception:
        return None


def validate_payout_addresses(raw):
    """Up to 10 lines; each an 0x address or an ENS name."""
    out = []
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if chain.is_address(line):
            out.append(chain.to_checksum(line))
        elif re.match(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.eth$",
                      line.lower()):
            out.append(line.lower())
        else:
            return None, ("'%s' is not a valid Ethereum address "
                          "or .eth name." % line[:60])
        if len(out) > 10:
            return None, "At most 10 payout addresses."
    return out, None


def parse_goal(raw):
    try:
        v = float((raw or "").replace(",", "").replace("$", "").strip())
    except ValueError:
        return None, "Funding goal must be a number (USD)."
    if not (0 < v <= 100_000_000):
        return None, "Funding goal must be between $1 and $100,000,000."
    return round(v, 2), None


# ------------------------------------------------------------ public pages

@app.route("/")
def index():
    rfps = db.list_rfps(("approved",))
    cards = []
    n_sponsors, n_donations = 0, 0
    recent = []
    for r in rfps:
        s = db.funding_summary(r["id"])
        pct = min(100, round(100 * s["total"] / r["funding_goal_usd"], 1)) \
            if r["funding_goal_usd"] else 0
        pl = db.pledges_for(r["id"])
        dn = db.donations_for(r["id"])
        n_sponsors += len(pl)
        n_donations += len(dn)
        for d in dn:
            recent.append({"rfp": r, "d": d})
        cards.append({"rfp": r, "sum": s, "pct": pct, "n_sponsors": len(pl),
                      "n_donations": len(dn)})
    recent.sort(key=lambda x: x["d"]["confirmed_at"] or 0, reverse=True)
    totals = {
        "count": len(cards),
        "goal": sum(c["rfp"]["funding_goal_usd"] for c in cards),
        "raised": sum(c["sum"]["total"] for c in cards),
        "sponsors": n_sponsors,
        "donations": n_donations,
    }
    state = chain_state()
    return render_template("index.html", cards=cards, totals=totals,
                           recent=recent[:8], state=state,
                           tokens=active_tokens(state),
                           donations_enabled=bool(state["verified"]
                                                  and active_tokens(state)))


@app.route("/rfp/<slug>")
def rfp_page(slug):
    r = db.rfp_by_slug(slug)
    if not r or r["status"] not in ("approved", "archived"):
        abort(404)
    s = db.funding_summary(r["id"])
    pct = min(100, round(100 * s["total"] / r["funding_goal_usd"], 1)) \
        if r["funding_goal_usd"] else 0
    state = chain_state()
    tokens = active_tokens(state)
    return render_template(
        "rfp.html", r=r, sum=s, pct=pct,
        pledges=db.pledges_for(r["id"]),
        donations=db.donations_for(r["id"]),
        payout_addresses=json.loads(r["payout_addresses"] or "[]"),
        state=state, tokens=tokens,
        donations_enabled=bool(state["verified"] and tokens
                               and r["status"] == "approved"))


@app.route("/submit", methods=["GET", "POST"])
def submit():
    if request.method == "GET":
        return render_template("submit.html")
    check_csrf()
    if request.form.get("website"):  # honeypot
        abort(400)
    if not rate_limit("submit:" + client_ip(),
                      config.SUBMISSIONS_PER_HOUR_PER_IP, 3600):
        return render_template(
            "submit.html", error="Too many submissions from your address; "
            "try again in an hour.", form=request.form), 429

    url_clean, err = validate_forum_url(request.form.get("discourse_url"))
    if err:
        return render_template("submit.html", error=err, form=request.form), 400

    title = (request.form.get("title") or "").strip()[:MAX_TITLE]
    if not title:
        title = fetch_discourse_title(url_clean) or ""
    if len(title) < 8:
        return render_template(
            "submit.html", error="Please give the RFP a title (at least 8 "
            "characters). We could not read one from the forum link.",
            form=request.form), 400

    summary = (request.form.get("summary") or "").strip()[:MAX_SUMMARY]
    if len(summary) < 40:
        return render_template(
            "submit.html", error="Please describe the RFP in at least 40 "
            "characters.", form=request.form), 400

    goal, err = parse_goal(request.form.get("goal"))
    if err:
        return render_template("submit.html", error=err, form=request.form), 400

    payout, err = validate_payout_addresses(request.form.get("payout"))
    if err:
        return render_template("submit.html", error=err, form=request.form), 400

    contact = (request.form.get("contact") or "").strip()[:200]
    rfp_id, slug = db.create_rfp(title, summary, url_clean, goal, payout,
                                 contact, status="pending")
    return render_template("submitted.html", title=title)


# ------------------------------------------------------------ donation API

@app.route("/api/donate/params")
def donate_params():
    """Global donation parameters (same treasury/tokens for every RFP)."""
    state = chain_state()
    tokens = active_tokens(state)
    if not (state["verified"] and tokens):
        return jsonify({"enabled": False, "reason": state["detail"]}), 503
    return jsonify({
        "enabled": True,
        "chain_id": config.CHAIN_ID,
        "treasury": state["treasury"],
        "treasury_label": config.TREASURY_LABEL,
        "tokens": {sym: {"address": a, "decimals": d}
                   for sym, (a, d) in tokens.items()},
    })


@app.route("/api/donate/confirm", methods=["POST"])
def donate_confirm():
    same_origin_only()
    if not rate_limit("confirm:" + client_ip(), 30, 600):
        abort(429)
    body = request.get_json(silent=True) or {}
    slug = str(body.get("slug") or "")
    tx_hash = str(body.get("tx_hash") or "").strip().lower()
    r = db.rfp_by_slug(slug)
    if not r or r["status"] != "approved":
        abort(404)
    state = chain_state()
    if not state["verified"]:
        return jsonify({"status": "error", "detail": state["detail"]}), 503
    v = chain.verify_donation_tx(tx_hash, state["treasury"],
                                 active_tokens(state))
    if not v["found"] and "malformed" in v["detail"]:
        return jsonify({"status": "error", "detail": v["detail"]}), 400
    existing = db.donation_by_hash(tx_hash)
    if existing and existing["rfp_id"] != r["id"] \
            and existing["status"] == "confirmed":
        return jsonify({"status": "error",
                        "detail": "this transaction is already credited to "
                                  "another RFP"}), 409
    _, status = db.record_donation(r["id"], tx_hash, v)
    if status == "already-confirmed":
        status = "confirmed"
    return jsonify({"status": status, "detail": v["detail"],
                    "amount": v["amount"], "token": v["token_symbol"]})


@app.route("/api/donate/status/<tx_hash>")
def donate_status(tx_hash):
    tx_hash = tx_hash.strip().lower()
    row = db.donation_by_hash(tx_hash)
    if not row:
        abort(404)
    if row["status"] == "pending" and rate_limit("st:" + tx_hash, 1, 5):
        state = chain_state()
        if state["verified"]:
            v = chain.verify_donation_tx(tx_hash, state["treasury"],
                                         active_tokens(state))
            if v["found"] and not v["pending"]:
                db.record_donation(row["rfp_id"], tx_hash, v)
                row = db.donation_by_hash(tx_hash)
    return jsonify({"status": row["status"], "detail": row["detail"],
                    "amount": row["amount"], "token": row["token_symbol"]})


# ------------------------------------------------------------ admin

@app.route("/admin", methods=["GET"])
def admin_login():
    if session.get("admin"):
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/login.html")


@app.route("/admin/login", methods=["POST"])
def admin_login_post():
    check_csrf()
    if not rate_limit("login:" + client_ip(),
                      config.LOGIN_ATTEMPTS_PER_MINUTE_PER_IP, 60):
        return render_template("admin/login.html",
                               error="Too many attempts; wait a minute."), 429
    pw = request.form.get("password", "")
    if hmac.compare_digest(pw, config.ADMIN_PASSWORD):
        session["admin"] = True
        session.permanent = False
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/login.html", error="Wrong password."), 403


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    check_csrf()
    session.clear()
    return redirect(url_for("index"))


@app.route("/admin/dashboard")
@admin_required
def admin_dashboard():
    pending = db.list_rfps(("pending",))
    approved = db.list_rfps(("approved",))
    other = db.list_rfps(("rejected", "archived"))
    rows = []
    for r in list(pending) + list(approved) + list(other):
        rows.append({"rfp": r, "sum": db.funding_summary(r["id"])})
    return render_template("admin/dashboard.html", rows=rows,
                           n_pending=len(pending), state=chain_state())


@app.route("/admin/rfp/<int:rfp_id>", methods=["GET", "POST"])
@admin_required
def admin_rfp(rfp_id):
    r = db.rfp_by_id(rfp_id)
    if not r:
        abort(404)
    error = None
    if request.method == "POST":
        check_csrf()
        action = request.form.get("action", "")
        if action in ("approve", "reject", "archive", "unarchive"):
            new = {"approve": "approved", "reject": "rejected",
                   "archive": "archived", "unarchive": "approved"}[action]
            fields = {"status": new}
            if new == "approved" and not r["approved_at"]:
                fields["approved_at"] = db.now()
            db.update_rfp(rfp_id, **fields)
        elif action == "feature":
            db.update_rfp(rfp_id, featured=0 if r["featured"] else 1)
        elif action == "edit":
            goal, err = parse_goal(request.form.get("goal"))
            payout, err2 = validate_payout_addresses(request.form.get("payout"))
            title = (request.form.get("title") or "").strip()[:MAX_TITLE]
            summary = (request.form.get("summary") or "").strip()[:MAX_SUMMARY]
            url_raw = (request.form.get("discourse_url") or "").strip()
            url_clean = ""
            err3 = None
            if url_raw:
                url_clean, err3 = validate_forum_url(url_raw)
            error = err or err2 or err3
            if not error and (len(title) < 8 or len(summary) < 40):
                error = "Title (8+) and summary (40+) are required."
            if not error:
                db.update_rfp(rfp_id, title=title, summary=summary,
                              details=(request.form.get("details")
                                       or "").strip()[:20000],
                              funding_goal_usd=goal,
                              payout_addresses=json.dumps(payout),
                              discourse_url=url_clean,
                              contact=(request.form.get("contact")
                                       or "").strip()[:200])
        elif action == "add_pledge":
            company = (request.form.get("company") or "").strip()[:120]
            amount, err = parse_goal(request.form.get("amount"))
            status = request.form.get("pstatus", "pledged")
            if status not in ("pledged", "received"):
                status = "pledged"
            if not company or err:
                error = err or "Company name is required."
            else:
                db.add_pledge(rfp_id, company, amount, status,
                              (request.form.get("note") or "").strip()[:300],
                              (request.form.get("url") or "").strip()[:300])
        elif action == "pledge_status":
            st = request.form.get("pstatus", "")
            if st in ("pledged", "received", "withdrawn"):
                db.update_pledge(int(request.form.get("pledge_id", 0)), st)
        elif action == "pledge_delete":
            db.delete_pledge(int(request.form.get("pledge_id", 0)))
        elif action == "recheck_donation":
            tx = (request.form.get("tx_hash") or "").strip().lower()
            state = chain_state()
            if state["verified"]:
                v = chain.verify_donation_tx(tx, state["treasury"],
                                             active_tokens(state))
                if v["found"] and not v["pending"]:
                    db.record_donation(rfp_id, tx, v)
        r = db.rfp_by_id(rfp_id)
    return render_template(
        "admin/rfp.html", r=r, error=error,
        sum=db.funding_summary(rfp_id),
        pledges=db.pledges_for(rfp_id, include_withdrawn=True),
        donations=db.donations_for(rfp_id, only_confirmed=False),
        payout_text="\n".join(json.loads(r["payout_addresses"] or "[]")))


@app.route("/healthz")
def healthz():
    state = chain_state()
    return jsonify({"ok": True, "treasury": state["treasury"],
                    "treasury_verified": state["verified"],
                    "tokens_ok": sorted(sym for sym, t in state["tokens"].items()
                                        if t["ok"])})


if __name__ == "__main__":
    print("TheDAO RFPs — admin password is in .env")
    state = chain_state()
    print("Treasury %s -> %s (verified: %s)" % (
        config.TREASURY_LABEL, state["treasury"], state["verified"]))
    app.run(host="127.0.0.1", port=config.PORT, debug=False)
