#!/bin/sh
# Launch reset: wipe ALL test data so the board starts from zero.
#
# Deletes every RFP, pledge, donation, uploaded logo, and the scanner cursor.
# Keeps: .env (config/signers), the admin password, and the schema.
# A timestamped backup of the database and logos is made first, so this is
# recoverable — but treat it as destructive and run it on purpose.
#
# Note: a fresh `git clone` deploy already starts with an EMPTY database
# (rfps.db and uploads/ are gitignored). You only need this script if the
# database was copied from a test machine, or to re-zero a staging box.
#
# Usage:  ./deploy/reset-for-launch.sh --yes-wipe-everything
set -e
cd "$(dirname "$0")/.."

if [ "$1" != "--yes-wipe-everything" ]; then
  echo "This deletes ALL RFPs, pledges, donations, and uploaded logos"
  echo "(after taking a backup). Run with:  $0 --yes-wipe-everything"
  exit 1
fi

if [ ! -f rfps.db ]; then
  echo "No rfps.db here — nothing to reset (a fresh deploy starts empty)."
  exit 0
fi

DEST="${RFPS_BACKUP_DIR:-$HOME/rfps-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# consistent pre-wipe backup (same mechanism as deploy/backup.sh)
./.venv/bin/python - "$DEST/pre-launch-reset-$STAMP.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect("rfps.db")
dst = sqlite3.connect(sys.argv[1])
with dst:
    src.backup(dst)
src.close(); dst.close()
PY
if [ -d uploads ]; then
  tar czf "$DEST/pre-launch-uploads-$STAMP.tar.gz" uploads
fi
echo "backup saved: $DEST/pre-launch-reset-$STAMP.db"

# the wipe: children first (donations/pledges reference rfps)
./.venv/bin/python - <<'PY'
import sqlite3
con = sqlite3.connect("rfps.db")
with con:
    d = con.execute("DELETE FROM donations").rowcount
    p = con.execute("DELETE FROM pledges").rowcount
    r = con.execute("DELETE FROM rfps").rowcount
    # scanner cursor: a fresh start scans from "now", not from test history
    con.execute("DELETE FROM meta WHERE key='scan_block'")
con.execute("VACUUM")
con.close()
print("wiped: %d donations, %d pledges, %d RFPs" % (d, p, r))
PY

# uploaded sponsor logos are test data too
if [ -d uploads ]; then
  rm -f uploads/*
  echo "cleared uploads/"
fi

echo
echo "Done. The board is empty. Next steps:"
echo "  1. restart the app (systemd: sudo systemctl restart thedao-rfps)"
echo "  2. add the real RFPs via /submit or the admin panel"
echo "  3. deploy each RFP's Safe from the admin panel (uses the CURRENT"
echo "     OPERATIONAL_SIGNERS in .env — verify them first!)"
