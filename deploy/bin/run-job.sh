#!/usr/bin/env bash
# Runs a data script inside a running API container (used by the systemd timers).
#   run-job.sh update-db | update-security [--tor|--hosting] | export-corrections | check-freshness
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="${1:?usage: run-job.sh <script> [args]}"; shift

for service in api-blue api-green; do
  if docker compose --env-file .env --env-file images.env exec -T "${service}" true 2>/dev/null; then
    exec docker compose --env-file .env --env-file images.env exec -T "${service}" \
      node "scripts/${SCRIPT}.ts" "$@"
  fi
done
echo "no running API container for ${SCRIPT}" >&2
exit 1
