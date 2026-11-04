# Deploying to one server

One Hetzner VPS runs everything in Docker. Cloudflare Tunnel connects the server to Cloudflare
from the inside, so the server opens **no public ports** (only SSH).

```
visitor ──► Cloudflare (DNS, TLS, DDoS) ──► cloudflared ──► caddy ─┬─► api-blue / api-green :8080
                                                                   └─► web-blue / web-green :3000
                                        postgres · redis · data/ (mmdb files, lists)
```

Two copies of the API and of the website run side by side. `deploy.sh` replaces them one at a
time while Caddy sends traffic to the other copy, so deploys have no downtime (tested: about
115,000 requests during a full rollout, 0 errors).

## What you need

- A Hetzner Cloud server: Ubuntu 24.04, CX22 or larger (2 vCPU, 4 GB RAM). The stack uses
  about 1.5 GB.
- A domain whose DNS is on Cloudflare (free plan).
- The GitHub repository, with the CI workflow building images into GHCR.

## 1. Prepare the server (once)

```sh
ssh root@SERVER_IP

# updates, firewall (SSH only), automatic security updates
apt update && apt -y upgrade
apt -y install ufw unattended-upgrades python3
ufw allow OpenSSH && ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sh

# deploy user, allowed to run docker
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/ipx && chown deploy:deploy /opt/ipx
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
```

Disable password logins in `/etc/ssh/sshd_config` (`PasswordAuthentication no`), then
`systemctl restart ssh`.

## 2. Copy the deploy files

From your machine, in the repository:

```sh
scp -r deploy/docker-compose.yml deploy/Caddyfile deploy/deploy.sh deploy/bin deploy/systemd deploy@SERVER_IP:/opt/ipx/
scp deploy/.env.production.example deploy@SERVER_IP:/opt/ipx/.env
```

On the server, as `deploy`:

```sh
cd /opt/ipx
mkdir -p data backups && sudo chown 1000:1000 data   # the containers run as uid 1000 (node)
nano .env                                  # fill in every value (see the comments)
chmod 600 .env
```

If the GitHub repository is private, let the server pull images: create a GitHub token with
`read:packages` and run `docker login ghcr.io -u YOUR_GITHUB_USER`.

## 3. Cloudflare Tunnel

1. Cloudflare dashboard > Zero Trust > Networks > Tunnels > **Create a tunnel** (Cloudflared).
2. Copy the token from the install command into `TUNNEL_TOKEN` in `/opt/ipx/.env`.
3. Add two **public hostnames** to the tunnel, both with service `HTTP` and URL `caddy:80`:
   - `api.example.com` (the value of `API_HOST`)
   - `example.com` (the value of `SITE_HOST`)
4. SSL/TLS mode: Full. The API trusts `CF-Connecting-IP` because `TRUSTED_PROXY=cloudflare`
   is set in `docker-compose.yml`; this is only safe because nothing else can reach the server.

## 4. First deploy

Push to `main` once so CI builds the images, then on the server:

```sh
cd /opt/ipx
./deploy.sh <commit sha>     # pulls the images, starts everything, runs migrations
./bin/run-job.sh update-db   # first download of the IP databases
./bin/run-job.sh update-security
curl -s -H "Host: $(grep ^API_HOST .env | cut -d= -f2)" 127.0.0.1:8088/health
```

Then open `https://example.com` and `https://api.example.com/json/8.8.8.8`.

## 5. Scheduled jobs (systemd timers)

```sh
sudo cp /opt/ipx/systemd/*.service /opt/ipx/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ipx-update-db.timer ipx-update-tor.timer ipx-update-hosting.timer \
  ipx-export-corrections.timer ipx-check-freshness.timer ipx-backup.timer
systemctl list-timers 'ipx-*'
```

| Timer                    | When (UTC)    | What                                                                                                                                    |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ipx-update-db`          | daily 03:30   | DB-IP City Lite (new edition monthly) and IPinfo Lite                                                                                   |
| `ipx-update-tor`         | hourly at :10 | Tor exit list                                                                                                                           |
| `ipx-update-hosting`     | daily 04:20   | AWS, Google, Azure, Cloudflare, DigitalOcean ranges                                                                                     |
| `ipx-export-corrections` | every 5 min   | accepted corrections to `data/location-overrides.json`                                                                                  |
| `ipx-check-freshness`    | hourly at :45 | alert if a database is older than 45 days, the Tor list older than 6 h, hosting ranges older than 3 days, or Redis/Postgres unreachable |
| `ipx-backup`             | daily 02:30   | `pg_dump` to `/opt/ipx/backups` (14 days kept)                                                                                          |

A failing job sends a message to `ALERT_WEBHOOK_URL` (the scripts do, and systemd does again
through `ipx-alert@.service` if a job cannot even start). Logs: `journalctl -u ipx-update-db`.

Copy the backups off the server too, e.g. with a nightly `rsync` or Hetzner Storage Box.

## 6. Automatic deploys from GitHub

In the GitHub repository settings:

- **Secrets**: `IPINFO_TOKEN`, `DEPLOY_HOST` (server IP), `DEPLOY_USER` (`deploy`),
  `DEPLOY_SSH_KEY` (a private key whose public key is in `/home/deploy/.ssh/authorized_keys`).
- **Variables**: `DEPLOY_ENABLED=true`, `NEXT_PUBLIC_API_URL=https://api.example.com`,
  `NEXT_PUBLIC_STATUS_URL=https://status.example.com`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Every push to `main` then runs the tests, builds and pushes both images to GHCR and runs
`./deploy.sh <sha>` on the server. To roll back, run `./deploy.sh <older sha>` on the server.

## 7. Status page

The `Status` workflow checks the site from GitHub every 5 minutes (outside your server) and
publishes a static page on the `status-data` branch.

1. Repository variables: `STATUS_CHECKS=API=https://api.example.com/health,Website=https://example.com/`
   and `STATUS_DOMAIN=status.example.com`.
2. Run the workflow once (Actions > Status > Run workflow).
3. Settings > Pages: deploy from branch `status-data`, folder `/`; custom domain
   `status.example.com`.
4. Cloudflare DNS: `CNAME status -> YOUR_GITHUB_USER.github.io` (DNS only, grey cloud).

Report incidents by editing `incidents.json` on the `status-data` branch:
`[{ "date": "2026-11-04", "title": "Slow responses", "body": "...", "resolved": true }]`.

## 8. Metrics

`GET /metrics` serves Prometheus metrics (requests by route and status, latency histogram,
429s, data age, memory). Set `METRICS_TOKEN` and scrape `https://api.example.com/metrics` with
`Authorization: Bearer <token>` from Grafana Cloud, Better Stack or your own Prometheus.

## Everyday commands (in /opt/ipx)

```sh
docker compose --env-file .env --env-file images.env ps
docker compose --env-file .env --env-file images.env logs -f api-blue
./bin/run-job.sh update-db                # refresh databases now
./deploy.sh <sha>                         # deploy or roll back
```
