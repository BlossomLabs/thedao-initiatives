# DevOps handoff: TheDAO Security Fund RFP board

You are deploying a small Flask + SQLite app that coordinates crypto donations
to Ethereum security projects. Everything is prepared; the full step-by-step
is in **DEPLOY.md**. This page is the context, the requirements, and the
acceptance checks.

## What the app is

- Python 3.9+ / Flask, SQLite database (single file, WAL mode), zero JS build
  step. All dependencies in `requirements.txt` (5 packages incl. gunicorn).
- Runs as **gunicorn** (config in `gunicorn.conf.py`, launcher `serve-prod.sh`)
  behind **Caddy** for automatic HTTPS (`deploy/Caddyfile`).
- A **systemd unit** is provided (`deploy/thedao-rfps.service`): auto-restart,
  survives reboot.
- A background thread inside the app scans Ethereum mainnet for incoming
  donations. It starts automatically under gunicorn (RFPS_SCANNER=1 is set by
  the launcher) and holds a file lock so exactly one process scans.
- The server holds **no private keys** and no funds. It only reads the chain.

## Server requirements

- Any small Linux VPS: 1 vCPU / 1 GB RAM is plenty (Hetzner CX11 class).
  Ubuntu 22.04/24.04 or Debian 12.
- Persistent disk for two paths inside the app directory: `rfps.db` and
  `uploads/`. Nightly backup script provided (`deploy/backup.sh`, cron it).
- Open ports 80/443 only. Gunicorn binds 127.0.0.1:4482; Caddy proxies to it.
- Outbound HTTPS must be allowed (Ethereum RPC endpoints, api.ensdata.net,
  api.deepseek.com, WalletConnect relay).

## Getting the code + repo setup (you do this first)

You receive two files from Griff:

- `thedao-rfps-launch.tar.gz`: the code as plain files, for reading and
  reference.
- `thedao-rfps.bundle`: the same code as a **complete git repository with
  history**. Use THIS to create the repo, so future updates from Griff's
  machine push cleanly to the same history.

Set up the repo (about 3 minutes):

1. Create a **private** GitHub repository named **`RFP-crowdfunding`**.
   Create it empty: no README, no license, no .gitignore.
2. Clone from the bundle and push:

```sh
git clone thedao-rfps.bundle thedao-rfps
cd thedao-rfps
git remote set-url origin git@github.com:<owner>/RFP-crowdfunding.git
git push -u origin main
```

3. Give **Griff admin access** to the repo (Settings, Collaborators). He
   ships fixes from his machine, so he needs push rights, and the project is
   his: if you create it under your personal account, plan to transfer
   ownership to him or his org later.

The server then clones from GitHub as usual (DEPLOY.md step 2).

## Deploy, in one breath

Follow DEPLOY.md sections 1 to 5: create the `rfps` user, clone the code,
`cp .env.production.template .env` and fill it in, install the systemd unit,
install the Caddyfile, point DNS, cron the backup. A fresh clone starts with
an **empty database on purpose**; all data from the dev machine was test data.

## The .env values

Non-secret values you can take from this document:

- `SITE_URL` = `https://fund.thedao.fund/` (keep the https:// prefix; the
  cookie and HSTS protections switch on it)
- `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `BIND_HOST=127.0.0.1`
- `OPERATIONAL_SIGNERS` = exactly these five, comma-separated, this order is
  fine:
  `0x839395e20bbB182fa440d08F850E6c7A8f6F0780,0xC46c67Bb7E84490D7EbdD0b8ecDaca68Cf3823F4,0x939E50655cf6dA7D643CFf8Cfa31c3033b16328A,0xb760FE1bbC4A2752aBCBb28291a57Cb0cA99fF44,0x5256d6d94eD14667fa1661a99F5B142B1e051B8e`
  (the app refuses to deploy Safes unless these validate; a typo fails closed)

Secrets Griff sends you separately (never by email, never in git):

- `ADMIN_PASSWORD` (a fresh one for production)
- `SITE_USERNAME` + `SITE_PASSWORD` (the private-preview login: while both
  are set, the whole site asks for them before showing anything; /healthz
  stays open for monitoring. Blank both + restart when Griff says go public.)
- `RPC_URL` (Alchemy/Infura/dRPC mainnet key)
- `AI_SEARCH_API_KEY` (DeepSeek; optional, search box hidden if empty)
- `WALLETCONNECT_PROJECT_ID` (optional; QR wallet connect hidden if empty)

Set `chmod 600 .env` after filling it in.

## Acceptance checks (done = all green)

1. `https://<domain>/healthz` returns `{"ok": true, "tokens_ok": [...9 tokens]}`
   with NO login (uptime monitors need it open).
2. Everything else asks for the site username/password first (a plain
   `curl -sI https://<domain>/` returns 401). After logging in, the front
   page loads with a valid TLS cert and `/admin` accepts the admin password.
3. `journalctl -u thedao-rfps` shows "Safe deploys: ENABLED (ok)" at boot.
4. Reboot the box once: the service comes back by itself.
5. Backup cron has produced a file in `~/rfps-backups` (run it once manually).
6. Security headers present: `curl -sI https://<domain> | grep -i strict`
   shows HSTS; the CSP header is there.

Griff then does the product-side launch himself: adds the real RFPs in the
admin panel, clicks Deploy Safe for each (his wallet signs; the app verifies
the Safe on-chain before showing it), and sends a $1 test donation. If a test
donation from an exchange credits within about 5 minutes, the scanner works.

## Day-2 operations

- Update: nothing to do by hand — a green push to `main` deploys itself via
  GitHub Actions and rolls back if the new revision fails its health check
  (DEPLOY.md, "How updates work later"). The manual path stays available:
  `su - rfps && cd thedao-rfps && ./deploy/deploy.sh <sha>`.
- The CI deploy needs a one-time setup on the box: a forced-command SSH key in
  the `rfps` user's authorized_keys plus a sudoers rule letting `rfps` run only
  `systemctl restart thedao-rfps`. Both are in DEPLOY.md, "One-time setup for
  the CI deploy" — please do this as part of the handoff.
- Logs: `journalctl -u thedao-rfps -f`
- Uptime monitoring: point anything at `/healthz`.
- The database is a single file; the provided backup script uses SQLite's
  online backup, safe while the app runs.
- If the site must be reset to zero (staging tests etc.):
  `./deploy/reset-for-launch.sh --yes-wipe-everything` (takes a backup first).

## Things that are intentional (please do not "fix")

- SQLite, single gunicorn worker with threads: correct at this traffic level,
  and the donation scanner requires a single scanning process (file-locked).
- `run.sh` is the dev server; production is `serve-prod.sh` via systemd.
- The 1 MB WalletConnect bundle in `static/vendor/` is vendored on purpose
  (strict CSP forbids CDN scripts); provenance + SHA-256 in
  `static/vendor/README.md`.
- Every security header, including HSTS and the strict CSP, comes from the
  app itself. The Caddyfile stays a plain reverse proxy; add no header
  config there.

Questions: the code is small and commented; `app.py` is the whole backend,
`chain.py` is all Ethereum access, `README.md` explains the money flow.
