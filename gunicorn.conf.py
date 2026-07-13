"""Gunicorn config for production. Launched by serve-prod.sh.

One worker with several threads is right for this app: traffic is light and
the background donation scanner must live in a single process. The scanner
still guards itself with a file lock, so more workers stay safe — but one
worker keeps things simple and avoids duplicate RPC polling.
"""
import os

# Aliased with a leading underscore: gunicorn treats every bare top-level name
# in this file as one of its own settings, and it has a setting literally named
# `config`, so a plain `import config` would collide.
import config as _cfg

# Bind to loopback by default; the TLS reverse proxy (Caddy/nginx) is what the
# public talks to. Override with BIND_HOST=0.0.0.0 only if you serve directly.
_host = _cfg.ENV.get("BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
bind = "%s:%d" % (_host, _cfg.PORT)

workers = 1
threads = 4
timeout = 60              # RPC calls + LLM search can take a few seconds
graceful_timeout = 30
keepalive = 5
accesslog = "-"          # stdout; systemd/journald captures it
errorlog = "-"
loglevel = "info"

# Tell app.py (imported as app:app, so no __main__) to start the scanner.
os.environ.setdefault("RFPS_SCANNER", "1")


def on_starting(server):
    # One-time boot banner in the logs, mirroring the dev-server startup.
    import chain
    ok, why = chain.signers_configured()
    server.log.info("TheDAO RFPs starting on %s", bind)
    server.log.info("Safe deploys: %s (%s)",
                    "ENABLED" if ok else "disabled", why)
