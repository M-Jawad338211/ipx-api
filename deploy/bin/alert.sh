#!/usr/bin/env bash
# Posts a message to ALERT_WEBHOOK_URL (from .env). Used by systemd OnFailure= hooks.
set -uo pipefail
cd "$(dirname "$0")/.."
URL="$(grep -E '^ALERT_WEBHOOK_URL=' .env | cut -d= -f2- | tr -d '"')"
MESSAGE="[ipx $(hostname)] ${*:-job failed}"
echo "${MESSAGE}" >&2
[ -n "${URL}" ] || exit 0
PAYLOAD=$(printf '%s' "${MESSAGE}" | python3 -c 'import json,sys; m=sys.stdin.read(); print(json.dumps({"text": m, "content": m}))')
curl -fsS -m 10 -H 'content-type: application/json' -d "${PAYLOAD}" "${URL}" >/dev/null
