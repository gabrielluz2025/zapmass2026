#!/usr/bin/env bash
# Normaliza / reatribui ownerUid (Postgres users.id) em connections_settings.json.
#
#   cd /opt/zapmass && bash deployment/repair-connection-owners.sh
#   cd /opt/zapmass && bash deployment/repair-connection-owners.sh --apply
#   cd /opt/zapmass && bash deployment/repair-connection-owners.sh --assign conn_XXX --email dono@mail.com --apply
#
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

CID="$(docker compose ps -q zapmass 2>/dev/null | head -1 || true)"
if [ -z "$CID" ]; then
  CID="$(docker ps -q -f name=zapmass-zapmass 2>/dev/null | head -1 || true)"
fi

if [ -n "$CID" ]; then
  echo "==> repair (container $(docker inspect -f '{{.Name}}' "$CID" | sed 's#^/##'))"
  SCRIPT="/app/scripts/repair-connection-owners.ts"
  docker exec "$CID" mkdir -p /app/scripts
  docker cp "$ROOT/scripts/repair-connection-owners.ts" "${CID}:${SCRIPT}"
  exec docker exec -e DATA_DIR=/app/data "$CID" ./node_modules/.bin/tsx "$SCRIPT" "$@"
fi

echo "ERRO: container zapmass não encontrado."
exit 1
