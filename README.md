# ipx-api

IP lookup API: geolocation, network, time zone, locale and security data for any IPv4 or IPv6
address, served from in-memory `.mmdb` databases. See [PLAN.md](PLAN.md) for the roadmap and
[docs/response.md](docs/response.md) for the response reference.

## Layout

| Path              | What                                                          |
| ----------------- | ------------------------------------------------------------- |
| `apps/api`        | Fastify service (Node 22 runs the TypeScript directly)        |
| `apps/web`        | Next.js 16 site: landing, docs (Fumadocs), sign-up, dashboard |
| `packages/db`     | Drizzle schema, migrations, plans, API-key helpers            |
| `packages/shared` | Response schemas (TypeBox) and the generated `openapi.json`   |
| `scripts`         | Data updaters: IP databases, Tor/hosting lists, country table |
| `data`            | Downloaded databases and lists (git-ignored)                  |
| `docs`            | Guides and response reference, rendered by the docs site      |
| `deploy`          | Production compose, Caddy, deploy script, systemd timers      |

## Quick start

```sh
pnpm install
cp .env.example .env            # add IPINFO_TOKEN
pnpm update-db                  # DB-IP City Lite + IPinfo Lite -> data/
pnpm update-security            # Tor exits + cloud ranges -> data/
docker compose up -d postgres redis
pnpm db:migrate                 # tables + plans
pnpm dev                        # API on http://localhost:8080
pnpm dev:web                    # website on http://localhost:3000
curl localhost:8080/json/8.8.8.8
```

Without `RESEND_API_KEY`, accounts work right after sign-up. With it, users confirm their
email with a 6-digit code before API keys work.

With Docker (API + Postgres + Redis, `data/` mounted into the container):

```sh
docker compose up --build -d
curl localhost:8080/json/8.8.8.8
docker compose exec api node scripts/update-db.ts         # refresh databases, hot reload
docker compose exec api node scripts/update-security.ts   # refresh lists, hot reload
```

## Commands

| Command                | What it does                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `pnpm check`           | Typecheck, lint and test every package (Turborepo)                                  |
| `pnpm test`            | Tests (need `data/`, Postgres and Redis); `RUN_LIVE_TESTS=1` adds the live Tor test |
| `pnpm bench`           | autocannon load test against a local single-process server                          |
| `pnpm openapi`         | Regenerate `packages/shared/openapi.json` from the route schemas                    |
| `pnpm update-db`       | Download DB-IP City Lite and IPinfo Lite (`--force` to re-download)                 |
| `pnpm update-security` | Download Tor exits (`--tor`) and hosting ranges (`--hosting`)                       |
| `pnpm build-countries` | Rebuild `apps/api/src/enrich/countries.json` (committed)                            |
| `pnpm db:migrate`      | Apply database migrations and upsert the plan catalogue                             |
| `pnpm db:generate`     | Generate a migration after changing `packages/db/src/schema.ts`                     |
| `pnpm format`          | Prettier                                                                            |

Data files are reloaded without a restart: the update scripts call `POST /internal/reload`
(accepted only from a local process), and the API also re-checks `data/` every 60 seconds.

## Deployment and operations

[deploy/README.md](deploy/README.md) sets up one server: Cloudflare Tunnel, blue/green
containers behind Caddy (zero-downtime `deploy.sh`), systemd timers for data updates,
corrections, freshness alerts and backups. CI (`.github/workflows/ci.yml`) tests, builds the
images and deploys `main`; `.github/workflows/status.yml` runs the external status page.

## Data and credits

IP data by [DB-IP](https://db-ip.com) (CC BY 4.0) and [IPinfo](https://ipinfo.io) (CC BY-SA
4.0). Tor exits from the Tor Project. Country facts from
[mledoze/countries](https://github.com/mledoze/countries) (ODbL-1.0). Time zone boundaries from
timezone-boundary-builder via geo-tz.
