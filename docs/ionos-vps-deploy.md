# IONOS VPS Deploy Runbook

Target domain: `deckreps.app`

Target server size: 4 vCPU, 8 GB RAM, 240 GB NVMe SSD.

## 1. Point DNS

In the registrar/DNS panel:

- `A` record: `deckreps.app` -> VPS public IPv4
- `CNAME` record: `www` -> `deckreps.app`

Wait for DNS to resolve before starting Caddy:

```bash
dig deckreps.app +short
dig www.deckreps.app +short
```

## 2. SSH In

```bash
ssh root@YOUR_VPS_IP
```

Create an app user:

```bash
adduser deckreps
usermod -aG sudo deckreps
```

Log back in as that user:

```bash
ssh deckreps@YOUR_VPS_IP
```

## 3. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

## 4. Install Caddy

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

## 5. Upload Or Clone App

```bash
sudo mkdir -p /opt/deckreps
sudo chown "$USER:$USER" /opt/deckreps
cd /opt/deckreps
git clone YOUR_REPO_URL app
cd app
```

If the repo is private, use a deploy key or upload a zip instead.

## 6. Create `.env`

```bash
cp .env.production.example .env
nano .env
```

Set:

- `ALLOWED_ORIGINS=https://deckreps.app`
- `VITE_SUPPORT_EMAIL=support@deckreps.app`
- `ADMIN_TOKEN=` to a long random token from `openssl rand -hex 32`
- AdSense IDs once ready
- `ADS_TXT_PUBLISHER_ID=pub-...`

## 7. Start The App

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8000/api/readiness
```

## 8. Configure Caddy

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do not expose ports `8000` or `8100` publicly.

## 10. Verify Public Site

```bash
curl -I https://deckreps.app
curl https://deckreps.app/api/health
curl https://deckreps.app/api/readiness
curl https://deckreps.app/shelector-api/health
curl https://deckreps.app/ads.txt
```

## 10.1. Verify The Live Multiplayer UI

After local changes are deployed to the VPS and `docker compose up -d --build`
has finished, run the same Goldfish pod browser playtest against production from
the workstation:

```powershell
$env:DECKREPS_BASE_URL='https://deckreps.app'
$env:DECKREPS_QA_ADMIN_TOKEN='<production ADMIN_TOKEN>'
$env:GOLDFISH_POD_ACTIONS='120'
node scripts/goldfish_pod_ui_playtest.js
```

The expected post-deploy result is:

- 3-player pod: 99-card decks imported, real engine started, zero pending actions, zero rejected actions.
- 4-player pod: 99-card decks imported, real engine started, zero pending actions, zero rejected actions.
- Artifacts saved under `playtest-artifacts/goldfish-pods/<run-id>/`.

Use the production `ADMIN_TOKEN` only for this private QA run so the browser
harness can bypass public rate limits. If you do not have the token in the local
shell, run a smaller public smoke pass and treat any 429 as an inconclusive test
rather than a gameplay failure.

## 11. Backups

Install the runtime volume backup:

```bash
mkdir -p /opt/deckreps/backups
chmod +x deploy/backup-runtime.sh
./deploy/backup-runtime.sh
```

Add a daily cron:

```bash
(crontab -l 2>/dev/null; echo "15 5 * * * cd /opt/deckreps/app && BACKUP_DIR=/opt/deckreps/backups ./deploy/backup-runtime.sh >/tmp/deckreps-backup.log 2>&1") | crontab -
```

## 12. Updating

```bash
cd /opt/deckreps/app
git pull
docker compose up -d --build
docker compose ps
```

Then repeat sections 10 and 10.1 before considering the VPS update done.
