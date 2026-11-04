#!/usr/bin/env bash
# Nightly Postgres dump into ./backups (kept 14 days). Copy them off the server too.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
FILE="backups/ipx-$(date -u +%Y-%m-%dT%H%M).sql.gz"
docker compose --env-file .env --env-file images.env exec -T postgres pg_dump -U ipx ipx | gzip > "${FILE}"
find backups -name 'ipx-*.sql.gz' -mtime +14 -delete
echo "backup written: ${FILE}"
