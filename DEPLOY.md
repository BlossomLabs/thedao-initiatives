# Deploying the RFP board

Copy-paste steps to take the board from this Mac to a public domain. Aimed at
a small Linux VPS (Hetzner/DigitalOcean, ~$5/mo); Render/Railway also work but
you lose the systemd/Caddy simplicity. SQLite is plenty at this scale.

Everything the code needs is here; the parts only you can do are flagged
**[you]** (buy a domain, get an RPC key, pick a password).

## 0. Before you touch a server — decisions **[you]**

- **Domain**: buy one (or use a subdomain like `rfps.thedao.fund`) and be
  ready to point an `A` record at the server's IP.
- **RPC key**: sign up for a free Alchemy/Infura/dRPC mainnet key. The public
  endpoints work but get rate-limited once a scanner polls them every 3 min.
- **Admin password**: think of a fresh long one; the sandbox password has been
  around for weeks.
- **Content**: settle the placeholder funding goals and decide whether the meta
  "This RFP board" entry stays public (see the note the assistant gave you).

## 1. Server setup (Ubuntu/Debian)

```sh
# as root, on the fresh server
adduser --disabled-password --gecos "" rfps
apt update && apt install -y python3-venv git caddy
```

## 2. Get the code + configure

```sh
su - rfps
git clone <your-repo-url> thedao-rfps   # or scp the folder up
cd thedao-rfps
cp .env.production.template .env
nano .env          # fill in SITE_URL, ADMIN_PASSWORD, OPERATIONAL_SIGNERS,
                   # RPC_URL, and any AI/onramp keys
chmod 600 .env
```

## 3. Run it under gunicorn via systemd

```sh
# back as a sudo user
sudo cp /home/rfps/thedao-rfps/deploy/thedao-rfps.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now thedao-rfps
journalctl -u thedao-rfps -f      # watch it boot; Ctrl-C to stop watching
```

You should see the startup banner and `Safe deploys: ENABLED`. The first
request takes a few seconds while tokens verify on-chain.

## 4. HTTPS with Caddy

```sh
sudo cp /home/rfps/thedao-rfps/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # change the domain to yours
sudo systemctl reload caddy
```

Point your domain's `A` record at the server IP first; Caddy fetches the TLS
certificate automatically within a minute. Visit `https://your-domain` — done.

## 5. Nightly backups

```sh
crontab -e -u rfps
# add:
0 4 * * *  /home/rfps/thedao-rfps/deploy/backup.sh >> /home/rfps/backup.log 2>&1
```

Backups land in `~/rfps-backups` (14-day retention). For off-host safety, add a
second line that `rclone`/`scp`s that folder somewhere else.

## 6. Post-launch checklist

- Hit `https://your-domain/healthz` — should return `{"ok": true, ...}`.
- Deploy a real RFP Safe from the admin panel and send a $1 test donation;
  confirm it credits, and that an *exchange* send credits within ~5 min (that
  exercises the background scanner, which now runs under gunicorn).
- Point an uptime monitor at `/healthz`.
- Name-tag each RFP Safe on Etherscan.

## How updates work later

```sh
su - rfps && cd thedao-rfps
git pull
sudo systemctl restart thedao-rfps
```

## Notes

- **`./run.sh` is dev-only** (Flask's built-in server). Production always goes
  through `serve-prod.sh` / the systemd unit / gunicorn.
- The donation **scanner runs in exactly one process**, protected by a file
  lock (`.scanner.lock`), so bumping gunicorn workers later stays safe.
- Card donations and WalletConnect are separate follow-ups; see
  `docs/card-donations-research.md` and `docs/launch-checklist.md`.
