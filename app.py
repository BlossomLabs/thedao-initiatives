"""TheDAO Security Fund — RFP funding coordination app.

Public: browse RFPs, submit an RFP from a Discourse forum link, donate
mainnet stablecoins directly to an RFP (funds go to the configured treasury).
Admin: approve/reject submissions, manage company pledges, recheck donations.
"""
import hmac
import ipaddress
import json
import os
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from functools import wraps

import markdown
import nh3
from flask import (Flask, abort, jsonify, redirect, render_template, request,
                   send_from_directory, session, url_for)
from markupsafe import Markup

import chain
import config
import db

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=config.COOKIE_SECURE,
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,  # room for a 1 MB logo upload
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


def order_cards(cards):
    """Board order: admin-pinned positions first (1 = top), then everything
    else by total raised (pledges + confirmed donations), newest first on ties."""
    def key(c):
        rank = c["rfp"]["sort_rank"]
        pinned = rank is not None and rank > 0
        return (0 if pinned else 1,
                rank if pinned else 0,
                -c["sum"]["total"],
                -(c["rfp"]["created_at"] or 0))
    return sorted(cards, key=key)


def donor_tokens(state):
    """What donors can pick: verified ERC20s plus native ETH."""
    out = dict(active_tokens(state))
    if config.NATIVE_ETH:
        out["ETH"] = ("native", 18)
    return out


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
    """Best-effort client IP for rate limiting.

    X-Forwarded-For is attacker-controlled unless a trusted proxy sets it, so
    we ignore it by default. Behind a proxy (config.TRUST_PROXY), the real
    client is the right-most hop the proxy appended, not the left-most (which
    the client can forge).
    """
    if config.TRUST_PROXY:
        xff = request.headers.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[-1].strip()
    return request.remote_addr or "?"


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
    site = config.ENV.get("SITE_URL", "").strip()
    if site and not site.endswith("/"):
        site += "/"
    return {"csrf_token": csrf_token, "TOKENS": config.TOKENS,
            "site_url": site or request.url_root}


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


# Everything nh3 lets through in RFP details. Anything else — scripts,
# iframes, event handlers, javascript:/data: URLs — is stripped, so a value
# written through the admin panel can never script the public page.
MD_TAGS = {"p", "br", "hr", "a", "strong", "em", "b", "i", "del", "sup",
           "sub", "code", "pre", "blockquote", "ul", "ol", "li",
           "h1", "h2", "h3", "h4", "h5", "h6",
           "table", "thead", "tbody", "tr", "th", "td"}
MD_ATTRS = {"a": {"href", "title"}, "ol": {"start"}}

# GitHub-style task lists ("- [ ] item"); python-markdown has no native
# support, so swap the brackets for checkbox glyphs before conversion.
_TASK_RE = re.compile(r"^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\](?=\s)", re.M)


@app.template_filter("md")
def md(text):
    """Admin-authored markdown -> sanitized HTML for the details field.

    nl2br keeps single line breaks visible, so pre-markdown plain-text
    entries render exactly as they did under white-space:pre-line.
    """
    text = _TASK_RE.sub(
        lambda m: m.group(1) + ("☑" if m.group(2) in "xX" else "☐"),
        text or "")
    html = markdown.markdown(text, extensions=["tables", "sane_lists", "nl2br"])
    return Markup(nh3.clean(html, tags=MD_TAGS, attributes=MD_ATTRS))


# ------------------------------------------------------------ validation

MAX_TITLE = 140
MAX_SUMMARY = 4000
FORUM_HOST_RE = re.compile(r"^[a-z0-9.-]+$")


def _ip_is_public(ipstr):
    ip = ipaddress.ip_address(ipstr)
    return not (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def _resolve_public_ips(host):
    """Resolve a host to its IPs, returning them only if EVERY IP is public.

    Returns (ips, None) or (None, reason). The caller pins one of these IPs
    for the actual connection so a DNS rebind between validation and fetch
    cannot swing it to an internal address.
    """
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return None, "host does not resolve"
    ips = [info[4][0] for info in infos]
    if not ips:
        return None, "host does not resolve"
    for ipstr in ips:
        if not _ip_is_public(ipstr):
            return None, "host resolves to a non-public address"
    return ips, None


def _is_public_hostname(host):
    ips, reason = _resolve_public_ips(host)
    return ips is not None


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


_fetch_pin_lock = threading.Lock()


def fetch_discourse_title(topic_url):
    """Best-effort: Discourse exposes topic JSON at <topic-url>.json.

    SSRF-hardened: we resolve the host to a set of IPs, confirm all are
    public, then pin DNS resolution to those exact IPs for the duration of
    the request. This closes the DNS-rebinding window where a low-TTL host
    could pass validation as public and then connect to an internal address.
    """
    try:
        u = urllib.parse.urlsplit(topic_url)
        host = (u.hostname or "").lower()
        ips, reason = _resolve_public_ips(host)
        if ips is None:
            return None
        pinned = set(ips)
        json_url = urllib.parse.urlunsplit(
            ("https", u.netloc, u.path.rstrip("/") + ".json", "", ""))

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                return None

        orig_gai = socket.getaddrinfo

        def pinned_gai(h, *a, **kw):
            # Only the target host is pinned to its validated public IPs;
            # any other lookup (there shouldn't be one) is re-validated.
            if (h or "").lower() == host:
                infos = orig_gai(next(iter(pinned)), *a, **kw)
                if any(info[4][0] not in pinned for info in infos):
                    raise socket.gaierror("pinned IP mismatch")
                return infos
            if not _is_public_hostname(h):
                raise socket.gaierror("blocked non-public host")
            return orig_gai(h, *a, **kw)

        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(
            json_url, headers={"User-Agent": "thedao-rfps/1.0",
                               "Accept": "application/json"})
        with _fetch_pin_lock:  # global getaddrinfo swap: serialize fetches
            socket.getaddrinfo = pinned_gai
            try:
                with opener.open(req, timeout=6) as resp:
                    body = resp.read(512 * 1024)
            finally:
                socket.getaddrinfo = orig_gai
        data = json.loads(body.decode("utf-8", "replace"))
        title = (data.get("title") or "").strip()
        return title[:MAX_TITLE] if title else None
    except Exception:
        return None


LOGO_DIR = os.path.join(config.BASE_DIR, "uploads")
LOGO_MAGIC = {b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg", b"RIFF": ".webp"}


def save_logo_upload(file_storage):
    """Validate + store an admin-uploaded sponsor logo.

    Returns (filename, None) or (None, error). Content is checked by magic
    bytes (png/jpg/webp only, max 1 MB) so mislabeled or scriptable files
    (like SVG) never get served.
    """
    if not file_storage or not file_storage.filename:
        return "", None
    blob = file_storage.read(1024 * 1024 + 1)
    if len(blob) > 1024 * 1024:
        return None, "Logo must be under 1 MB."
    ext = None
    for magic, e in LOGO_MAGIC.items():
        if blob.startswith(magic):
            ext = e
            break
    if ext == ".webp" and blob[8:12] != b"WEBP":
        ext = None
    if not ext:
        return None, "Logo must be a PNG, JPG, or WEBP image."
    import secrets as _secrets
    name = _secrets.token_hex(8) + ext
    os.makedirs(LOGO_DIR, exist_ok=True)
    with open(os.path.join(LOGO_DIR, name), "wb") as f:
        f.write(blob)
    return name, None


@app.route("/logos/<name>")
def serve_logo(name):
    if not re.fullmatch(r"[0-9a-f]{16}\.(png|jpg|webp)", name):
        abort(404)
    return send_from_directory(LOGO_DIR, name, max_age=86400)


@app.template_global()
def onramp_link(safe_address):
    """Card-checkout URL template for buying USDC delivered to an RFP Safe.

    Returns (url_template, prefilled: bool). "{AMT}" in the template is
    replaced client-side with the donor's chosen dollar amount. Providers
    that need a partner key fall back to guardarian's keyless page when no
    key is configured; the widget always shows the Safe address with a copy
    button, so an unprefilled checkout still works.
    """
    p, key = config.ONRAMP_PROVIDER, config.ONRAMP_API_KEY
    if p == "transak" and key:
        return ("https://global.transak.com/?apiKey=%s"
                "&cryptoCurrencyCode=USDC&network=ethereum&fiatCurrency=USD"
                "&defaultFiatAmount={AMT}&walletAddress=%s"
                % (urllib.parse.quote(key), safe_address)), True
    if p == "moonpay" and key:
        return ("https://buy.moonpay.com/?apiKey=%s"
                "&currencyCode=usdc&baseCurrencyCode=usd"
                "&baseCurrencyAmount={AMT}&walletAddress=%s"
                % (urllib.parse.quote(key), safe_address)), True
    # No keyless fallback: a checkout that demands full KYC for $25 and lets
    # the network/address drift (Guardarian, tried July 2026) kills donations.
    # Card returns at public launch via Coinbase Onramp guest checkout
    # (SMS+email only in the US, Apple Pay/debit, server-locked address+chain)
    # or a Transak/MoonPay partner key. Until then: no card tab.
    return "", False


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
                      "n_donations": len(dn),
                      "logos": [p for p in pl if p["logo"]][:4],
                      "enabled": bool(r["safe_address"])})
    cards = order_cards(cards)
    recent.sort(key=lambda x: x["d"]["confirmed_at"] or 0, reverse=True)
    totals = {
        "count": len(cards),
        "goal": sum(c["rfp"]["funding_goal_usd"] for c in cards),
        "raised": sum(c["sum"]["total"] for c in cards),
        "sponsors": n_sponsors,
        "donations": n_donations,
    }
    state = chain_state()
    tokens = donor_tokens(state)
    return render_template("index.html", cards=cards, totals=totals,
                           recent=recent[:8], state=state, tokens=tokens,
                           tokens_ok=bool(active_tokens(state)))


@app.route("/rfp/<slug>")
def rfp_page(slug):
    r = db.rfp_by_slug(slug)
    if not r or r["status"] not in ("approved", "archived"):
        abort(404)
    s = db.funding_summary(r["id"])
    pct = min(100, round(100 * s["total"] / r["funding_goal_usd"], 1)) \
        if r["funding_goal_usd"] else 0
    state = chain_state()
    tokens = donor_tokens(state)
    return render_template(
        "rfp.html", r=r, sum=s, pct=pct,
        pledges=db.pledges_for(r["id"]),
        donations=db.donations_for(r["id"]),
        state=state, tokens=tokens,
        donations_enabled=bool(active_tokens(state) and r["safe_address"]
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

    url_raw = (request.form.get("discourse_url") or "").strip()
    url_clean = ""
    if url_raw:
        url_clean, err = validate_forum_url(url_raw)
        if err:
            return render_template("submit.html", error=err,
                                   form=request.form), 400

    title = (request.form.get("title") or "").strip()[:MAX_TITLE]
    if not title and url_clean:
        title = fetch_discourse_title(url_clean) or ""
    if len(title) < 8:
        return render_template(
            "submit.html", error="Please give the RFP a title (at least 8 "
            "characters)." + (" We could not read one from the forum link."
                              if url_clean else ""),
            form=request.form), 400

    summary = (request.form.get("summary") or "").strip()[:MAX_SUMMARY]
    if len(summary) < 40:
        return render_template(
            "submit.html", error="Please describe the RFP in at least 40 "
            "characters.", form=request.form), 400

    goal, err = parse_goal(request.form.get("goal"))
    if err:
        return render_template("submit.html", error=err, form=request.form), 400

    contact = (request.form.get("contact") or "").strip()[:200]
    details = (request.form.get("details") or "").strip()[:20000]
    rfp_id, slug = db.create_rfp(title, summary, url_clean, goal, [],
                                 contact, status="pending", details=details)
    return render_template("submitted.html", title=title)


# ------------------------------------------------------------ donation API

def _row_token_qty(row):
    """Token quantity from the raw on-chain amount (amount stores USD)."""
    sym = row["token_symbol"]
    dec = 18 if sym == "ETH" else (config.TOKENS.get(sym) or (None, None))[1]
    try:
        return int(row["amount_raw"]) / (10 ** dec) if dec else row["amount"]
    except (TypeError, ValueError):
        return row["amount"]


_ens_cache = {}  # lowercase address -> (name-or-empty, fetched_at)
ENS_CACHE_TTL = 3600


@app.route("/api/ens-name/<address>")
def ens_name(address):
    """Reverse-resolve an address to its primary ENS name (or null)."""
    address = address.strip()
    if not chain.is_address(address):
        abort(400)
    key = address.lower()
    hit = _ens_cache.get(key)
    if hit and time.time() - hit[1] < ENS_CACHE_TTL:
        return jsonify({"name": hit[0] or None})
    name = ""
    try:
        req = urllib.request.Request(
            "https://api.ensdata.net/%s" % chain.to_checksum(address),
            headers={"User-Agent": "thedao-rfps/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode())
        cand = (data.get("ens") or data.get("ens_primary") or "").strip()
        # only display a forward-verified name (ensdata reports the address
        # the name forward-resolves to; require it to match)
        if cand and (data.get("address") or "").lower() == key:
            name = cand
    except Exception:
        pass
    _ens_cache[key] = (name, time.time())
    return jsonify({"name": name or None})


@app.route("/api/donate/params")
def donate_params():
    """Global donation parameters (same treasury/tokens for every RFP)."""
    state = chain_state()
    tokens = donor_tokens(state)
    if not (state["verified"] and tokens):
        return jsonify({"enabled": False, "reason": state["detail"]}), 503
    priced, rates = {}, {}
    for sym, (a, d) in tokens.items():
        try:
            rates[sym] = chain.usd_rate(sym)
            priced[sym] = {"address": a, "decimals": d}
        except Exception:
            continue  # cannot price it safely right now: do not offer it
    return jsonify({
        "enabled": True,
        "chain_id": config.CHAIN_ID,
        "treasury": state["treasury"],
        "treasury_label": config.TREASURY_LABEL,
        "tokens": priced,
        "rates": rates,
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
    if not r["safe_address"]:
        return jsonify({"status": "error",
                        "detail": "this RFP has no donation address yet"}), 503
    state = chain_state()
    tokens = active_tokens(state)
    if not tokens:
        return jsonify({"status": "error", "detail": state["detail"]}), 503
    v = chain.verify_donation_tx(tx_hash, r["safe_address"], tokens)
    if not v["found"] and "malformed" in v["detail"]:
        return jsonify({"status": "error", "detail": v["detail"]}), 400
    existing = db.donation_by_hash(tx_hash)
    if existing and existing["rfp_id"] != r["id"]:
        # This tx is already bound to a different RFP (any state). record_donation
        # never re-points rfp_id, so crediting here would silently land on the
        # other RFP while telling this one it succeeded. Reject instead.
        return jsonify({"status": "error",
                        "detail": "this transaction is already recorded for "
                                  "another RFP"}), 409
    _, status = db.record_donation(r["id"], tx_hash, v)
    if status == "already-confirmed":
        status = "confirmed"
    return jsonify({"status": status, "detail": v["detail"],
                    "amount": v["amount"], "token": v["token_symbol"],
                    "amount_usd": v.get("amount_usd")})


@app.route("/api/donate/status/<tx_hash>")
def donate_status(tx_hash):
    tx_hash = tx_hash.strip().lower()
    row = db.donation_by_hash(tx_hash)
    if not row:
        abort(404)
    if row["status"] == "pending" and rate_limit("st:" + tx_hash, 1, 5):
        r = db.rfp_by_id(row["rfp_id"])
        state = chain_state()
        tokens = active_tokens(state)
        if tokens and r and r["safe_address"]:
            v = chain.verify_donation_tx(tx_hash, r["safe_address"], tokens)
            if v["found"] and not v["pending"]:
                db.record_donation(row["rfp_id"], tx_hash, v)
                row = db.donation_by_hash(tx_hash)
    return jsonify({"status": row["status"], "detail": row["detail"],
                    "amount": _row_token_qty(row),
                    "token": row["token_symbol"],
                    "amount_usd": row["amount"]})


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
    if not rate_limit("login-global", config.LOGIN_ATTEMPTS_PER_MINUTE_GLOBAL, 60):
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
        elif action == "edit":
            goal, err = parse_goal(request.form.get("goal"))
            title = (request.form.get("title") or "").strip()[:MAX_TITLE]
            summary = (request.form.get("summary") or "").strip()[:MAX_SUMMARY]
            url_raw = (request.form.get("discourse_url") or "").strip()
            url_clean = ""
            err3 = None
            if url_raw:
                url_clean, err3 = validate_forum_url(url_raw)
            error = err or err3
            rank_raw = (request.form.get("sort_rank") or "").strip()
            rank = None
            if rank_raw:
                try:
                    rank = max(1, min(999, int(rank_raw)))
                except ValueError:
                    error = error or "Pin position must be a number (1-999)."
            if not error and (len(title) < 8 or len(summary) < 40):
                error = "Title (8+) and summary (40+) are required."
            if not error:
                db.update_rfp(rfp_id, title=title, summary=summary,
                              details=(request.form.get("details")
                                       or "").strip()[:20000],
                              funding_goal_usd=goal,
                              discourse_url=url_clean,
                              sort_rank=rank,
                              contact=(request.form.get("contact")
                                       or "").strip()[:200])
        elif action == "add_pledge":
            company = (request.form.get("company") or "").strip()[:120]
            amount, err = parse_goal(request.form.get("amount"))
            status = request.form.get("pstatus", "pledged")
            if status not in ("pledged", "received"):
                status = "pledged"
            purl = (request.form.get("url") or "").strip()[:300]
            if purl and not purl.lower().startswith(("http://", "https://")):
                purl = ""  # reject javascript:/data: and other schemes
            logo, logo_err = save_logo_upload(request.files.get("logo"))
            if not company or err or logo_err:
                error = err or logo_err or "Company name is required."
            else:
                db.add_pledge(rfp_id, company, amount, status,
                              (request.form.get("note") or "").strip()[:300],
                              purl, logo)
        elif action == "pledge_status":
            st = request.form.get("pstatus", "")
            if st in ("pledged", "received", "withdrawn"):
                db.update_pledge(int(request.form.get("pledge_id", 0)), st)
        elif action == "pledge_delete":
            db.delete_pledge(int(request.form.get("pledge_id", 0)))
        elif action == "recheck_donation":
            tx = (request.form.get("tx_hash") or "").strip().lower()
            state = chain_state()
            tokens = active_tokens(state)
            if tokens and r["safe_address"]:
                v = chain.verify_donation_tx(tx, r["safe_address"], tokens)
                if v["found"] and not v["pending"]:
                    db.record_donation(rfp_id, tx, v)
        r = db.rfp_by_id(rfp_id)
    signers_ok, signers_detail = chain.signers_configured()
    return render_template(
        "admin/rfp.html", r=r, error=error,
        sum=db.funding_summary(rfp_id),
        pledges=db.pledges_for(rfp_id, include_withdrawn=True),
        donations=db.donations_for(rfp_id, only_confirmed=False),
        signers_ok=signers_ok, signers_detail=signers_detail,
        signers=config.OPERATIONAL_SIGNERS, safe_threshold=config.SAFE_THRESHOLD)


# ------------------------------------------------ Safe-per-RFP deployment

@app.route("/api/admin/rfps/<int:rfp_id>/safe-deploy-params")
@admin_required
def safe_deploy_params(rfp_id):
    """Everything the admin wallet needs to deploy this RFP's Safe."""
    same_origin_only()
    r = db.rfp_by_id(rfp_id)
    if not r:
        abort(404)
    ok, why = chain.signers_configured()
    if not ok:
        return jsonify({"enabled": False, "reason": why}), 503
    chain_name = ("sepolia" if request.args.get("chain") == "sepolia"
                  else "mainnet")
    return jsonify({
        "enabled": True,
        "chain": chain_name,
        "chain_id": (config.SEPOLIA_CHAIN_ID if chain_name == "sepolia"
                     else config.CHAIN_ID),
        "factory": config.SAFE_PROXY_FACTORY,
        "calldata": chain.safe_deploy_calldata(rfp_id),
        "signers": config.OPERATIONAL_SIGNERS,
        "threshold": config.SAFE_THRESHOLD,
        "already_deployed": r["safe_address"] or None,
    })


@app.route("/api/admin/rfps/<int:rfp_id>/safe-confirm", methods=["POST"])
@admin_required
def safe_confirm(rfp_id):
    """Verify a deploy tx, and (mainnet only) store the verified address."""
    same_origin_only()
    r = db.rfp_by_id(rfp_id)
    if not r:
        abort(404)
    body = request.get_json(silent=True) or {}
    tx_hash = str(body.get("tx_hash") or "").strip().lower()
    chain_name = ("sepolia" if body.get("chain") == "sepolia" else "mainnet")
    if not re.fullmatch(r"0x[0-9a-f]{64}", tx_hash):
        return jsonify({"status": "error", "detail": "malformed tx hash"}), 400
    address, err = chain.extract_deployed_safe(tx_hash, chain_name)
    if err == "pending":
        return jsonify({"status": "pending",
                        "detail": "waiting for the deploy tx to be mined"})
    if err:
        return jsonify({"status": "error", "detail": err}), 400
    ok, detail = chain.verify_safe(address, chain_name)
    if not ok:
        return jsonify({"status": "error",
                        "detail": "Safe deployed at %s but REJECTED: %s"
                                  % (address, detail)}), 400
    if chain_name == "mainnet":
        if r["safe_address"] and r["safe_address"].lower() != address.lower():
            return jsonify({"status": "error",
                            "detail": "this RFP already has a different Safe: "
                                      + r["safe_address"]}), 409
        db.update_rfp(rfp_id, safe_address=address)
    return jsonify({"status": "ok", "address": address, "chain": chain_name,
                    "stored": chain_name == "mainnet", "detail": detail})


@app.route("/healthz")
def healthz():
    state = chain_state()
    return jsonify({"ok": True, "treasury": state["treasury"],
                    "treasury_verified": state["verified"],
                    "tokens_ok": sorted(sym for sym, t in state["tokens"].items()
                                        if t["ok"])})


# ------------------------------------------------ donation auto-discovery
# Background scanner: watches every RFP Safe for incoming transfers of the
# accepted tokens and credits them automatically. Nobody has to paste a tx
# hash; the manual path remains as an instant-gratification fallback.

SCAN_INTERVAL_SECS = 180
SCAN_CHUNK_BLOCKS = 2000


def _scan_once():
    state = chain_state()
    tokens = active_tokens(state)
    if not tokens:
        return
    safes = {}  # padded topic -> (rfp_id, safe_address)
    for r in db.list_rfps(("approved",)):
        if r["safe_address"]:
            topic = "0x" + "0" * 24 + r["safe_address"].lower().replace("0x", "")
            safes[topic] = (r["id"], r["safe_address"])
    if not safes:
        return
    head = chain.get_block_number()
    safe_head = head - (config.MIN_CONFIRMATIONS - 1)
    last = int(db.meta_get("scan_block", "0") or 0)
    if last == 0:
        # first run: start from now; older donations can be credited manually
        db.meta_set("scan_block", str(safe_head))
        return
    if last >= safe_head:
        return
    token_addrs = [a for a, _ in tokens.values()]
    frm = last + 1
    while frm <= safe_head:
        to = min(frm + SCAN_CHUNK_BLOCKS - 1, safe_head)
        try:
            logs = chain.rpc_call("eth_getLogs", [{
                "fromBlock": hex(frm), "toBlock": hex(to),
                "address": token_addrs,
                "topics": [chain.TRANSFER_TOPIC, None, list(safes.keys())],
            }]) or []
        except chain.RpcError:
            return  # try again next cycle; scan_block stays put
        seen = []
        for lg in logs:
            tx = (lg.get("transactionHash") or "").lower()
            dest = (lg.get("topics") or [None, None, None])[2]
            if not tx or not dest or dest.lower() not in safes:
                continue
            seen.append((tx, safes[dest.lower()]))
        for tx, (rfp_id, safe_addr) in seen:
            existing = db.donation_by_hash(tx)
            if existing and existing["status"] != "pending":
                continue
            v = chain.verify_donation_tx(tx, safe_addr, tokens)
            if v["ok"]:
                db.record_donation(rfp_id, tx, v)
        db.meta_set("scan_block", str(to))
        frm = to + 1


def _scanner_loop():
    while True:
        try:
            _scan_once()
        except Exception as e:
            print("scanner error: %s" % e)
        time.sleep(SCAN_INTERVAL_SECS)


if __name__ == "__main__":
    print("TheDAO RFPs — admin password is in .env")
    state = chain_state()
    print("Treasury %s -> %s (verified: %s)" % (
        config.TREASURY_LABEL, state["treasury"], state["verified"]))
    ok, why = chain.signers_configured()
    print("Safe deploys: %s (%s)" % ("ENABLED" if ok else "disabled", why))
    threading.Thread(target=_scanner_loop, daemon=True,
                     name="donation-scanner").start()
    # BIND_HOST=0.0.0.0 in .env exposes the app on the local network (e.g. to
    # click Deploy from a machine that has wallet keys). Default stays
    # localhost-only.
    app.run(host=config.ENV.get("BIND_HOST", "127.0.0.1").strip() or "127.0.0.1",
            port=config.PORT, debug=False)
