"""Bounded unauthenticated GET observations. No redirects, cookies or mutations."""
import base64
import datetime
import hashlib
import json
import pathlib
import re
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect())
paths = ["/", "/api/auth/me", "/healthz", "/api/version", "/api/board/settings",
         "/api/initiatives.json", "/llms.txt", "/api/admin/leads", "/api/admin/backup",
         "/api/watchlist", "/api/comments/mine", "/api/security-review-nonexistent"]
urls = ["https://initiatives.thedao.fund" + p for p in paths]
urls += ["http://initiatives.thedao.fund/api/auth/me", "http://initiatives.thedao.fund/"]
selected = ["content-type", "cache-control", "content-security-policy",
            "content-security-policy-report-only", "strict-transport-security",
            "x-content-type-options", "x-frame-options", "referrer-policy",
            "permissions-policy", "access-control-allow-origin",
            "access-control-allow-credentials", "location", "x-app-version", "etag"]
observations = []
for url in urls:
    item = {"url": url, "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TheDAO-bounded-security-review/2026-10-07"})
        try:
            res = opener.open(req, timeout=15)
        except urllib.error.HTTPError as e:
            res = e
        with res:
            body = res.read(1024 * 1024 + 1)
            item.update(status=res.code,
                        headers={k: res.headers[k] for k in selected if k in res.headers},
                        body_bytes=len(body), truncated=len(body) > 1024 * 1024,
                        body_sha256=hashlib.sha256(body).hexdigest())
            if url == "https://initiatives.thedao.fund/":
                html = body.decode("utf-8", errors="replace")
                scripts = re.findall(r"<script\b([^>]*)>(.*?)</script\s*>", html, re.S | re.I)
                hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'"
                          for attrs, s in scripts if not re.search(r"\bsrc\s*=", attrs, re.I)]
                policy = res.headers.get("content-security-policy", "")
                item["inline_script_hashes"] = hashes
                item["all_inline_hashes_in_enforced_csp"] = all(h in policy for h in hashes)
            if url.endswith("/api/version") and res.code == 200:
                item["public_version"] = json.loads(body)
            if url.endswith("/api/initiatives.json") and res.code == 200:
                feed = json.loads(body)
                private = {"contact", "funders", "email", "sessionHash", "claimToken", "detailsPrivate"}
                def secret_keys(value):
                    out = []
                    if isinstance(value, dict):
                        out += [k for k in value if k in private]
                        for v in value.values():
                            out += secret_keys(v)
                    elif isinstance(value, list):
                        for v in value:
                            out += secret_keys(v)
                    return out
                item["feed_count"] = feed.get("count")
                item["private_field_names_present"] = sorted(set(secret_keys(feed)))
    except Exception as e:
        item["error"] = str(e)
    observations.append(item)
dest = pathlib.Path(__file__).with_name("public-site.json")
dest.write_text(json.dumps({"method": "unauthenticated GET, no redirect or cookie", "observations": observations}, indent=2) + "\n")
print(json.dumps([{k: item[k] for k in ("url", "status", "error") if k in item} for item in observations], indent=2))
if any("error" in item for item in observations):
    raise SystemExit(1)
