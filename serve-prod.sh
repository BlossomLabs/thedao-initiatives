#!/bin/sh
# Production launcher: gunicorn behind a TLS reverse proxy.
# Dev/local use stays on ./run.sh (Flask dev server). This is what the
# systemd service runs on the host.
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install -q -r requirements.txt

# RFPS_SCANNER=1 makes the imported app start the donation scanner (there is
# no __main__ under gunicorn). gunicorn.conf.py also sets this as a fallback.
export RFPS_SCANNER=1
exec ./.venv/bin/gunicorn -c gunicorn.conf.py app:app
