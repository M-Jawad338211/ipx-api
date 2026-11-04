#!/usr/bin/env bash
# Zero-downtime deploy of a given image tag. Run on the server in the deploy directory:
#   ./deploy.sh <tag>          e.g. ./deploy.sh 3f2c1ab   (rollback = deploy an older tag)
# Needs IPX_REGISTRY in .env (e.g. ghcr.io/your-github-user).
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: ./deploy.sh <image tag>}"
REGISTRY="$(grep -E '^IPX_REGISTRY=' .env | cut -d= -f2- | tr -d '"' || true)"
REGISTRY="${REGISTRY:-${IPX_REGISTRY:?set IPX_REGISTRY in .env}}"

cat > images.env.next <<IMAGES
IPX_API_IMAGE=${REGISTRY}/ipx-api:${TAG}
IPX_WEB_IMAGE=${REGISTRY}/ipx-web:${TAG}
IMAGES

compose() { docker compose --env-file .env --env-file images.env.next "$@"; }

if [ "${IPX_SKIP_PULL:-0}" != 1 ]; then  # IPX_SKIP_PULL=1: images built locally (testing)
  echo "==> Pulling ${TAG}"
  compose pull --quiet api-blue web-blue
fi

echo "==> Starting shared services"
compose up -d --wait postgres redis caddy
if grep -qE '^TUNNEL_TOKEN=.+' .env; then compose --profile tunnel up -d cloudflared; fi

echo "==> Running database migrations"
compose run --rm --no-deps api-blue node packages/db/src/migrate.ts

# One copy at a time: Caddy keeps serving from the other while this one restarts.
for service in api-blue api-green web-blue web-green; do
  echo "==> Updating ${service}"
  compose up -d --no-deps --wait --wait-timeout 180 "${service}"
done

mv images.env.next images.env
docker image prune -f --filter "until=168h" >/dev/null
echo "==> Deployed ${TAG}"
