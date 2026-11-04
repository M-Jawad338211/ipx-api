# Claude Code build plan — IP Lookup API

**How to use:** create an empty GitHub repo, save this file as `PLAN.md` in it, open Claude Code in the repo and say:
_"Read PLAN.md. Execute Phase 1 only, run the tests, then stop and list what you need from me."_ Repeat per phase.

## Project

- **Working name:** `ipx-api` (rename once the domain is chosen).
- **API stack:** Node 22 + TypeScript 6.0 (Node runs the `.ts` sources directly via type stripping; `tsc` only typechecks; TypeScript 7 is not used because typescript-eslint does not support it yet), Fastify 5 (plain Fastify, no NestJS), TypeBox type provider, `@fastify/swagger` (OpenAPI), `maxmind` (mmdb reader), `geo-tz`, Postgres via Drizzle, Redis via ioredis, Vitest.
- **Web stack:** Next.js 16 + Tailwind 4 + shadcn/ui; docs with **Fumadocs** (`fumadocs-ui`, `fumadocs-mdx`, `fumadocs-openapi`).
- **Monorepo:** pnpm workspaces + Turborepo, Docker.
- **Layout:**
  - `apps/api` — Fastify service
  - `apps/web` — Next.js 16 landing + dashboard + Fumadocs docs at `/docs`
  - `packages/shared` — TypeBox response/request schemas + inferred types (single source of truth)
  - `packages/db` — Drizzle schema + migrations, used by `apps/api` and `apps/web`
  - `packages/sdk-js` — typed fetch wrapper
  - `scripts/` — data updaters (DB files, security lists)
  - `data/` — mmdb files and downloaded lists, git-ignored
  - `docs/` — `response.md` and other MDX content consumed by Fumadocs

## Non-negotiables

- No database query on the lookup hot path. Lookups come from in-memory `.mmdb` readers only. API-key checks are served from an in-memory LRU / Redis cache; Postgres only on a cache miss.
- IPv4 and IPv6 handled in every validator, limiter and lookup.
- Trust `CF-Connecting-IP` / `X-Forwarded-For` only when `TRUSTED_PROXY=cloudflare`; otherwise use the socket address.
- Private/reserved IPs (`10/8`, `192.168/16`, `127/8`, `::1`, `fc00::/7`, etc.) return `200` with `{ "reserved": true }`, never an error.
- **Single source of truth for the response schema:** TypeBox schemas in `packages/shared/schema.ts`. Fastify uses them for validation and fast serialization; `@fastify/swagger` turns them into `openapi.json`; the SDK and the Fumadocs API reference are built from that. CI fails if the committed `openapi.json` is stale. `docs/response.md` documents every field; every field has a test.
- The API runs as one Node process per server. Workers never download from the internet themselves: `scripts/` download to `data/`, the server only reloads from disk. If the API is ever clustered, reload must reach every process.
- Keep it boring: one service, no queues, no microservices, no GraphQL, no NestJS. Ask before adding any dependency over 1 MB.
- Never commit `data/*.mmdb` or `.env`.
- Work one phase at a time. After each phase: run tests, then list what is blocked on me (keys, accounts, decisions).
- Once Phase 1 is accepted the response schema is frozen; breaking changes go to `/v2/`.

## Environment variables (supplied by me — see the manual guide)

`IPINFO_TOKEN` · `MAXMIND_LICENSE_KEY` (optional) · `DATABASE_URL` · `REDIS_URL` · `TRUSTED_PROXY` · `RESEND_API_KEY` · `PADDLE_API_KEY` · `PADDLE_WEBHOOK_SECRET` · `ABUSEIPDB_KEY` (optional) · `ALERT_WEBHOOK_URL`

Provide `.env.example` with every variable and a one-line comment.

---

## Phase 1 — Core lookup service (2–3 days)

1. Scaffold the monorepo: pnpm workspaces + Turborepo (`turbo.json` pipeline: `openapi` → `build` → `test`), ESLint + Prettier, Vitest, multi-stage Dockerfile for `apps/api`, `docker-compose.yml` with api + postgres + redis.
2. `scripts/update-db.ts`:
   - Download **DB-IP City Lite** (`https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz`, current month, fall back to previous month if 404).
   - Download **IPinfo Lite** (`https://ipinfo.io/data/ipinfo_lite.mmdb?token=$IPINFO_TOKEN`). If `IPINFO_TOKEN` is unset, skip this download, keep the existing `data/ipinfo_lite.mmdb` and log a warning with its build date (from the mmdb metadata).
   - IPinfo Lite carries only `asn` (string, e.g. `"AS15169"` → normalize to integer `15169`), `as_name`, `as_domain`, `country`, `country_code`, `continent`, `continent_code`, English only. City, region, lat/long and localized country/continent names come from DB-IP City Lite (saved as `data/dbip-city-lite.mmdb`, ~127 MB). DB-IP Lite has no postal code, timezone or accuracy radius (`postal` is always `null` on free data), and city/region names are English only, so `lang=` localizes country and continent names and falls back to English for city/region.
   - Merge rule: country and ASN come from IPinfo. If DB-IP's country disagrees with IPinfo's (e.g. `2001:4860:4860::8888`: IPinfo US, DB-IP Montreal, CA), city, region, lat/long and the coordinate-based timezone are `null` rather than mixing two countries.
   - gunzip, log sha256, write to `data/*.tmp`, atomic rename, then `POST http://127.0.0.1:8080/internal/reload` (localhost-only route) so readers hot-swap without restart. In Docker the updaters run inside the API container (`docker compose exec api node scripts/update-db.ts`) so the reload call really comes from loopback; the API also re-checks `data/` every 60 s.
3. `apps/api/src/lookup/`: open both readers at boot; `lookup(ip)` returns the normalized object defined in `packages/shared`. Missing fields → `null`, never throw.
4. Enrichment (all offline):
   - `apps/api/src/enrich/countries.json` (committed, rebuilt with `pnpm build-countries`) from the `mledoze/countries` repo plus IANA `zone.tab`: currency code/name/symbol, calling code, languages, flag emoji, zones per country. `is_eu` comes from a built-in list of the 27 member states. (Moved out of `data/` because it is static reference data that tests and the Docker image need.)
   - `geo-tz` → IANA timezone from lat/long; compute current UTC offset and DST flag at request time. (`geo-tz` is ~74 MB unpacked — approved: the small alternatives disagree with exact boundaries on 5–10 % of inhabited points.) Keep it off the p99: memoize results in an LRU keyed by the coordinate pair (DB-IP returns a limited set of city coordinates), and pick geo-tz's preload vs lazy cache mode from the benchmark's memory and latency numbers. **Decided: lazy.** Preload costs 1.7 s and ~1.2 GB RSS; lazy mode added ~60 MB for the ~9,400 distinct coordinates behind 30,000 random IPs, p99 0.43 ms per uncached lookup. `TZ_PRELOAD=true` remains available. Uses geo-tz's comprehensive dataset (one zone per country, e.g. `Asia/Karachi`); without coordinates, the country's zone is used when it has exactly one.
5. Security sets, loaded into a CIDR trie (IPv4 and IPv6), refreshed from `data/` on a timer:
   - Tor exits: `https://check.torproject.org/exit-addresses` (hourly, via `scripts/`).
   - Hosting ranges: AWS `ip-ranges.json`, GCP `cloud.json` + Google `goog.json`, Azure ServiceTags (resolve the weekly file URL from the download page), Cloudflare, DigitalOcean (daily, via `scripts/`) → `is_hosting`, `hosting_provider`.
   - `is_proxy` / `is_vpn` default `false` with `security.source: "basic"` until a paid dataset is added.
6. Routes (`/v1` prefix, plus unprefixed aliases for ip-api-style compatibility):
   - `GET /json` → caller's IP · `GET /json/:ip` · query params `fields=`, `lang=` (en, de, es, fr, ja, pt-BR, ru, zh-CN — whatever the mmdb carries), `callback=` (JSONP; callback name validated against `^[A-Za-z_$][\w$.]{0,63}$`).
   - `GET /health` (readers loaded + DB file dates) · `POST /internal/reload` (127.0.0.1 only).
   - Error shape: `{ "success": false, "error": { "code": "invalid_ip", "message": "..." } }` with codes `invalid_ip`, `invalid_request` (bad `fields`/`callback`/query values), `unauthorized`, `not_found`, `rate_limited`, `service_unavailable` (databases not loaded), `internal_error`.
7. Tests: `8.8.8.8` (US, ASN 15169, is_hosting true), `2001:4860:4860::8888`, `10.0.0.1` (reserved), garbage strings, a Tor exit from a checked-in fixture list (plus an opt-in live test), `fields=` filtering, `lang=` fallback to English, JSONP callback validation.
8. Benchmark with `autocannon`: target ≥ 5,000 req/s and < 5 ms p99 on a laptop, single process.
9. Export `openapi.json` (from `@fastify/swagger`) to `packages/shared/openapi.json` and commit it.

**Acceptance:** `docker compose up` → `curl localhost:8080/json/8.8.8.8` returns the full documented JSON; all tests green; `docs/response.md` complete; `openapi.json` committed and current.

## Phase 2 — Keys, limits, website (3–5 days)

10. Postgres schema in `packages/db` (Drizzle + migrations): `users`, `api_keys` (hashed, prefix shown once), `plans`, `subscriptions`, `usage_daily (key_id, date, count)`.
11. Auth: `?key=` or `Authorization: Bearer`. Anonymous allowed on `/json` and `/json/:ip` with per-IP limits (1,000/day, 45/min) via Redis sliding window. Keyed plans: Free $0, 10k/mo · Pro $20/month, 1M/mo (the only paid plan). Send `X-RateLimit-Limit/Remaining/Reset`; 429 with `Retry-After`.
12. Usage: increment a Redis counter per key per day; one in-process loop flushes to Postgres every 60 s. No queue.
13. `POST /v1/batch` — keyed only, max 100 IPs, same per-item shape.
14. `apps/web` (Next.js 16, Tailwind 4, shadcn/ui, Fumadocs):
    - Landing page with live "your IP" demo and plan comparison.
    - Docs at `/docs` with Fumadocs: guides from `docs/*.mdx` (including `response.md`), API reference generated by `fumadocs-openapi` from `packages/shared/openapi.json` with its interactive playground; `llms.txt` output enabled.
    - Auth: email + password sign-up and login (scrypt, httpOnly session cookie). Email confirmation by 6-digit code (OTP) sent through Resend, **only when `RESEND_API_KEY` is set**: then sign-up still works, but the dashboard shows "Confirm your email to access the features, like API keys", key creation is locked and the API answers `401` for keys of unconfirmed accounts. Without the key, accounts work right after sign-up. Codes expire after 10 minutes, one resend per minute, 5 attempts per code.
    - Dashboard: keys CRUD (max 10 active, secret shown once), usage chart (last 30 days, plain SVG), current plan and monthly quota bar.
    - `/credits` attribution page (DB-IP link, IPinfo, Tor Project, mledoze/countries) and footer link.
    - `/terms`, `/privacy` drafts with an accuracy disclaimer and IP-retention statement (I will review).
15. Billing: Paddle checkout + webhook → `subscriptions.plan`. Everything behind `PAYMENTS_ENABLED=false` until I supply keys; dashboard shows "contact us" meanwhile. Needs `PADDLE_CLIENT_TOKEN`, `PADDLE_ENVIRONMENT`, `PADDLE_PRICE_PRO` and `PADDLE_WEBHOOK_SECRET`.
    - Implementation notes: accounts live in the Next.js app (server actions over `packages/db`); the Fastify API only validates keys (in-memory cache, 60 s), enforces limits in Redis (Lua sliding windows for anonymous callers, IPv6 per /64; monthly quota per account for keys) and flushes per-key daily usage to Postgres. Without Redis the limits fail open; without Postgres, keyed requests get `503`.

**Acceptance:** sign up → create key → request with key → usage appears in dashboard; anonymous limits enforced; batch rejects anonymous callers.

## Phase 3 — Ops and distribution (2 days)

16. Scheduled updates: systemd timer (or GitHub Action hitting the server) runs `update-db` nightly and the security-list updaters on their schedules; on failure POST to `ALERT_WEBHOOK_URL`. `/health` reports DB age; alert if > 45 days. **Done:** `deploy/systemd/` timers run the scripts inside the API container (`bin/run-job.sh`); scripts and a systemd `OnFailure=` hook alert; `/health` has a `warnings` list (database > 45 days, Tor list > 6 h, hosting > 3 days) checked hourly by `check-freshness`; nightly Postgres backup.
17. Observability: pino JSON logs, `/metrics` (Prometheus format), request-id header. **Done:** hand-rolled Prometheus metrics (requests, latency histogram, 429s, usage flushed, data age, memory), `/metrics` behind `METRICS_TOKEN` or local-only, `X-Request-Id` reused or minted.
18. Deployment: `deploy/README.md` for a single Hetzner VPS with Cloudflare Tunnel (no open ports) or Caddy; GitHub Actions: test → build image → push to GHCR → SSH deploy with zero-downtime restart. **Done:** Cloudflare Tunnel → Caddy → blue/green copies of API and website; `deploy.sh <sha>` migrates, then replaces one copy at a time (tested: ~115k requests during a full rollout, 0 errors); website Docker image (Next.js standalone); `.github/workflows/ci.yml`.
19. ~~`packages/sdk-js`~~: skipped for now (decided 2026-11-04).
20. OpenAPI 3.1 spec served at `/openapi.json` and validated in CI; Postman collection generated from it. **Done:** Redocly lint in CI, `packages/shared/postman_collection.json` (`pnpm postman`, checked in CI).
21. Public status page: uptime checks against `/health` from outside the server (hosted checker or a GitHub Action), shown at `status.<domain>` with current state, 90-day uptime and incident notes; linked from the site footer and docs. **Done:** `.github/workflows/status.yml` every 5 min + `scripts/status-check.ts`; static page on the `status-data` branch served by GitHub Pages, so it stays up when the server is down; incidents in `incidents.json`.
22. **Done** (Turnstile captcha when keys are set, admins via `ADMIN_EMAILS`, `export-corrections` every 5 min, /24 or /48 scope on review). IP correction form on the website: IP (prefilled with the visitor's), correct country/region/city, optional email and note. Submissions stored in a Postgres `corrections` table with status `new / accepted / rejected`, rate-limited per IP, with a captcha. Accepted corrections go into a local override file in `data/` that the lookup applies on top of the mmdb results; a simple admin list in the dashboard to review them.

**Acceptance:** push to `main` deploys; nightly update runs and reports; OpenAPI spec validates; status page shows live state; a submitted and accepted correction changes the lookup result.

## Later (not now)

- Paid city DB swap (MaxMind GeoIP2 / DB-IP commercial) behind the same reader interface.
- VPN/proxy dataset (IPinfo Privacy, IP2Proxy).
- Second region + read-only fallback copy of the DBs on disk.
- Python and PHP SDKs.
- If we ever build our own IP data (latency measurements, corrections, ML scoring): a separate Python data pipeline that outputs `.mmdb` files; the Node API stays as is.
