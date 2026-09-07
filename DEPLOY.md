# Deploying the RFP board

Copy-paste steps to take the board from this Mac to a public domain. Aimed at
a small Linux VPS (Hetzner/DigitalOcean, ~$5/mo); Render/Railway also work but
you lose the systemd/Caddy simplicity. SQLite is plenty at this scale.

Everything the code needs is here; the parts only you can do are flagged
**[you]** (buy a domain, get an RPC key, pick a password).

## 0. Before you touch a server — decisions **[you]**

- **Domain**: buy one (or use a subdomain like `fund.thedao.fund`) and be
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
nano .env          # fill in ADMIN_PASSWORD, SITE_USERNAME/SITE_PASSWORD,
                   # RPC_URL, and the optional AI / WalletConnect keys
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

## 6. Zero out test data (launch gate)

Everything on the test machine — RFPs, pledges, donations, the deployed
Safes — is test data and must NOT appear on the real site.

- A fresh `git clone` deploy **already starts with an empty database**
  (`rfps.db`, `uploads/`, and `.env` are gitignored), so if you followed
  step 2 there is nothing to clean.
- If you copied the database from the test machine (or want to re-zero a
  staging box), run the reset — it takes a backup first, then deletes every
  RFP, pledge, donation, uploaded logo, and the scanner cursor:

```sh
./deploy/reset-for-launch.sh --yes-wipe-everything
sudo systemctl restart thedao-rfps
```

- **Old test Safes stay on-chain forever** (nothing can delete a deployed
  multisig) — they were deployed with the OLD signer set, so just stop
  referencing them: after the reset, re-add the real RFPs and deploy each
  one's Safe fresh from the admin panel. Before the first deploy,
  double-check `OPERATIONAL_SIGNERS` in the server `.env` is the corrected
  five-address set.

## 7. Post-launch checklist

- Hit `https://your-domain/healthz` — should return `{"ok": true, ...}`.
- Deploy a real RFP Safe from the admin panel and send a $1 test donation;
  confirm it credits, and that an *exchange* send credits within ~5 min (that
  exercises the background scanner, which now runs under gunicorn).
- Point an uptime monitor at `/healthz`.
- Name-tag each RFP Safe on Etherscan.

## How updates work later

**Pushing to `main` deploys.** GitHub Actions (`.github/workflows/ci.yml`) runs
the tests, byte-compiles, shellchecks the scripts, and boots the app under
gunicorn to check `/healthz` and `Safe deploys: ENABLED`. Only if all of that
is green does it SSH in and run `deploy/deploy.sh`, which checks out that exact
commit, installs dependencies, restarts the unit, and waits for `/healthz`. A
revision that does not come up healthy is **rolled back automatically** to the
previous commit.

The manual path still works and is unchanged:

```sh
su - rfps && cd thedao-rfps
./deploy/deploy.sh $(git rev-parse origin/main)   # same script CI runs
# or the old way:
git pull && sudo systemctl restart thedao-rfps
```

**RFP content ships with the deploy too.** RFPs live as markdown files in
`content/rfps/` (see the README there). Pushing one to `main` publishes it at
the restart CI triggers; the admin dashboard's "Sync content files" button
still works for an instant publish without a restart.

> The `*/5 * * * * git pull -q origin main` content-sync cron that earlier
> versions of this file recommended is now **redundant and harmful** — CI
> already deploys every push, and that cron would pull `main` straight back on
> top of an automatic rollback. If it is in the `rfps` crontab, remove it.

## One-time setup for the CI deploy

Do this once on the server; after that every green push to `main` deploys.

### 1. Make a deploy keypair (on your machine, not the server)

```sh
ssh-keygen -t ed25519 -f ci-deploy -N "" -C "github-actions@thedao-rfps"
```

### 2. Install the public key on the box, locked to the deploy script

As a sudo user:

```sh
sudo -u rfps mkdir -p /home/rfps/.ssh
sudo -u rfps chmod 700 /home/rfps/.ssh
# paste ci-deploy.pub as the KEY part below, all on one line:
echo 'restrict,command="/home/rfps/thedao-rfps/deploy/deploy.sh" ssh-ed25519 AAAA...KEY... github-actions@thedao-rfps' \
  | sudo -u rfps tee -a /home/rfps/.ssh/authorized_keys
sudo -u rfps chmod 600 /home/rfps/.ssh/authorized_keys
```

`restrict` turns off port/agent/X11 forwarding and PTY allocation, and the
forced `command=` means this key can run **only** `deploy/deploy.sh` — it
cannot get a shell. A leaked CI key can deploy a commit that is already on
`origin`, and nothing else.

### 3. Let `rfps` restart the unit, and only that unit

```sh
sudo visudo -f /etc/sudoers.d/rfps-deploy
```

```
rfps ALL=(root) NOPASSWD: /usr/bin/systemctl restart thedao-rfps
rfps ALL=(root) NOPASSWD: /bin/systemctl restart thedao-rfps
```

(Both paths, because `systemctl` lives in `/usr/bin` on Ubuntu and `/bin` on
some Debian images. `visudo` refuses to save a file with a syntax error.)

Check it, as `rfps`:

```sh
sudo -n systemctl restart thedao-rfps     # must work without a password
sudo -n systemctl stop thedao-rfps        # must be REFUSED
```

### 4. Repository secrets

Settings, Secrets and variables, Actions:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | contents of the private `ci-deploy` file (the whole thing, including the BEGIN/END lines) |
| `DEPLOY_HOST` | the server's hostname or IP |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <host>` — pins the host key so the deploy never trusts a new one blindly |
| `DEPLOY_PORT` | only if sshd is not on 22 |
| `RPC_URL` | optional; used by the weekly live-chain check so it does not lean on public endpoints |

Then create an Environment named **`production`** (Settings, Environments).
The deploy job is attached to it, so deploys show up in the repo's Deployments
tab — and if you later want a human click before each one, adding a required
reviewer there is the only change needed.

### 5. First deploy

Push anything to `main` and watch the run. The deploy step prints the commit,
then `==> <sha> is live and healthy`. To rehearse the rollback path, deploy a
commit you know is broken: the run goes red and the site stays up on the
previous one.

## Notes

- **`./run.sh` is dev-only** (Flask's built-in server). Production always goes
  through `serve-prod.sh` / the systemd unit / gunicorn.
- The donation **scanner runs in exactly one process**, protected by a file
  lock (`.scanner.lock`), so bumping gunicorn workers later stays safe.
- WalletConnect ships in the app; it activates when WALLETCONNECT_PROJECT_ID
  is set (and the domain is allowlisted in the Reown dashboard).
- Card donations are a separate follow-up; see
  `docs/card-donations-research.md`.
- The site starts in PRIVATE PREVIEW when SITE_USERNAME/SITE_PASSWORD are set
  in .env; blank them and restart to go public.
