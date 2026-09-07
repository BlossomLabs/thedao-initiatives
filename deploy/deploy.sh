#!/bin/sh
# Server-side deploy, run as the `rfps` user. GitHub Actions drives this over
# SSH after CI is green (.github/workflows/ci.yml); it also works by hand.
#
#   ./deploy/deploy.sh <commit-sha>      on the box
#   ssh rfps@host "deploy <commit-sha>"  from CI — the forced command in
#                                        authorized_keys lands here, so the
#                                        CI key can do nothing else
#
# It checks out the exact commit CI tested, installs deps BEFORE touching the
# running service, restarts the unit, and waits for /healthz. A revision that
# does not come up healthy is rolled back to the previous commit, so a bad
# push self-heals instead of leaving the fund site down.
#
# Untracked files survive: .env, rfps.db, uploads/ and .scanner.lock are all
# gitignored, so the hard reset below never touches data or config.
set -e
cd "$(dirname "$0")/.."

SERVICE="${RFPS_SERVICE:-thedao-rfps}"
HEALTH_URL="${RFPS_HEALTH_URL:-http://127.0.0.1:4482/healthz}"
HEALTH_TRIES=30   # x2s = 60s; gunicorn boot plus the first on-chain token check

# Under the forced command the requested revision arrives in
# SSH_ORIGINAL_COMMAND ("deploy <sha>") instead of argv.
REV="${1:-}"
if [ -z "$REV" ] && [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  REV=$(echo "$SSH_ORIGINAL_COMMAND" | awk '{print $2}')
fi
if [ -z "$REV" ]; then
  echo "usage: $0 <commit-sha>" >&2
  exit 2
fi
# Nothing arriving over SSH reaches git as an option or a path: a bare hex
# commit id is the only thing this script will ever deploy.
if ! echo "$REV" | grep -Eq '^[0-9a-f]{7,40}$'; then
  echo "refusing to deploy '$REV': not a commit sha" >&2
  exit 2
fi

# Returns 0 once the service answers /healthz with {"ok": true}. Uses the venv
# python purely as an HTTP client, so it keeps working even when the revision
# being tested is the one that is broken.
health_ok() {
  ./.venv/bin/python - "$HEALTH_URL" <<'PY' 2>/dev/null
import json, sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=5) as r:
        sys.exit(0 if r.status == 200 and json.load(r).get("ok") else 1)
except Exception:
    sys.exit(1)
PY
}

wait_healthy() {
  i=0
  while [ "$i" -lt "$HEALTH_TRIES" ]; do
    if health_ok; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

# Install deps, then swap the service. pip runs first on purpose: a broken
# requirements.txt fails here, with the old revision still serving traffic.
install_and_restart() {
  [ -d .venv ] || python3 -m venv .venv
  ./.venv/bin/pip install -q -r requirements.txt
  sudo -n systemctl restart "$SERVICE"
}

PREV=$(git rev-parse HEAD)
echo "==> deploying $REV (current: $PREV)"

git fetch --prune --quiet origin
# Stay ON main rather than detaching, so the content-sync cron in DEPLOY.md
# (git pull every 5 min) keeps working alongside this.
git checkout --quiet main
git reset --hard --quiet "$REV"

install_and_restart

if wait_healthy; then
  echo "==> $REV is live and healthy"
  exit 0
fi

echo "!! $REV failed its health check after $((HEALTH_TRIES * 2))s" >&2
echo "!! rolling back to $PREV" >&2
git reset --hard --quiet "$PREV"
install_and_restart

if wait_healthy; then
  echo "!! rolled back to $PREV; the site is up on the previous revision" >&2
else
  echo "!! ROLLBACK ALSO UNHEALTHY — the site is down, look at the box now:" >&2
  echo "!!   journalctl -u $SERVICE -n 100 --no-pager" >&2
fi
exit 1
