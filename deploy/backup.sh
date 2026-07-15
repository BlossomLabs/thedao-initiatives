#!/bin/sh
# Nightly backup of the database + uploaded logos.
# Uses sqlite's online .backup so the copy is consistent even mid-write.
# Keeps the last 14 days. Cron it, e.g.:
#   0 4 * * *  /home/rfps/thedao-rfps/deploy/backup.sh >> /home/rfps/backup.log 2>&1
set -e
cd "$(dirname "$0")/.."

DEST="${RFPS_BACKUP_DIR:-$HOME/rfps-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# consistent DB snapshot (sqlite online backup via the app's own venv, so no
# separate sqlite3 CLI is needed on the host)
./.venv/bin/python - "$DEST/rfps-$STAMP.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect("rfps.db")
dst = sqlite3.connect(sys.argv[1])
with dst:
    src.backup(dst)
src.close(); dst.close()
PY

# uploaded sponsor logos (skip if none yet)
if [ -d uploads ]; then
  tar czf "$DEST/uploads-$STAMP.tar.gz" uploads
fi

# prune anything older than 14 days
find "$DEST" -name 'rfps-*.db' -mtime +14 -delete
find "$DEST" -name 'uploads-*.tar.gz' -mtime +14 -delete

echo "backup ok: $DEST/rfps-$STAMP.db"
