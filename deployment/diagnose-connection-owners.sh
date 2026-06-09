#!/usr/bin/env bash
# Diagnóstico / correção de ownerUid em connections_settings.json (vazamento entre tenants).
# Os dados ficam no volume Docker zapmass-data → /app/data (NÃO em /opt/zapmass/data no host).
#
# Na VPS:
#   cd /opt/zapmass && bash deployment/diagnose-connection-owners.sh
#   cd /opt/zapmass && bash deployment/diagnose-connection-owners.sh --json
#   cd /opt/zapmass && bash deployment/diagnose-connection-owners.sh --fix conn_XXX firebaseUid [--prior uidErrado]
#
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

find_zapmass_container() {
  local cid=""
  if command -v docker >/dev/null 2>&1; then
    if [ -f docker-compose.yml ]; then
      cid="$(docker compose ps -q zapmass 2>/dev/null | head -1 || true)"
    fi
    if [ -z "$cid" ]; then
      cid="$(docker ps -q -f name=zapmass-zapmass 2>/dev/null | head -1 || true)"
    fi
    if [ -z "$cid" ]; then
      cid="$(docker ps -q -f name=zapmass-api 2>/dev/null | head -1 || true)"
    fi
  fi
  echo "$cid"
}

CID="$(find_zapmass_container)"

if [ -n "$CID" ]; then
  CNAME="$(docker inspect -f '{{.Name}}' "$CID" | sed 's#^/##')"
  echo "==> diagnose (container ${CNAME})"

  if ! docker exec "$CID" test -f /app/data/connections_settings.json 2>/dev/null; then
    echo "==> AVISO: /app/data/connections_settings.json ausente no volume."
    docker exec "$CID" ls -la /app/data 2>/dev/null || true
  fi

  SCRIPT_IN_IMAGE="/app/scripts/diagnose-connection-owners.ts"
  if ! docker exec "$CID" test -f "$SCRIPT_IN_IMAGE" 2>/dev/null; then
    echo "==> Copiando script para o container (imagem ainda sem scripts/)..."
    docker exec "$CID" mkdir -p /app/scripts
    docker cp "$ROOT/scripts/diagnose-connection-owners.ts" "${CID}:/app/scripts/diagnose-connection-owners.ts"
    SCRIPT_IN_IMAGE="/app/scripts/diagnose-connection-owners.ts"
  fi

  EVO_URL="$(docker exec "$CID" printenv EVOLUTION_API_URL 2>/dev/null || true)"
  EVO_KEY="$(docker exec "$CID" printenv EVOLUTION_API_KEY 2>/dev/null || true)"
  EVO_URL="${EVO_URL:-http://evolution:8080}"

  exec docker exec \
    -e DATA_DIR=/app/data \
    -e EVOLUTION_API_URL="$EVO_URL" \
    -e EVOLUTION_API_KEY="$EVO_KEY" \
    "$CID" \
    ./node_modules/.bin/tsx "$SCRIPT_IN_IMAGE" "$@"
fi

echo "==> AVISO: container zapmass não encontrado — tentando volume no host..."
VOL_MP=""
if command -v docker >/dev/null 2>&1; then
  VOL_MP="$(docker volume inspect zapmass_zapmass-data -f '{{.Mountpoint}}' 2>/dev/null || true)"
  if [ -z "$VOL_MP" ]; then
    VOL_MP="$(docker volume inspect zapmass-data -f '{{.Mountpoint}}' 2>/dev/null || true)"
  fi
fi

if [ -n "$VOL_MP" ] && [ -f "${VOL_MP}/connections_settings.json" ]; then
  echo "==> diagnose (volume ${VOL_MP})"
  export DATA_DIR="$VOL_MP"
  export EVOLUTION_API_URL="${EVOLUTION_API_URL:-http://127.0.0.1:8080}"
  exec npm run diagnose:connection-owners -- "$@"
fi

echo "ERRO: não foi possível localizar dados."
echo "  - Suba o stack: docker compose up -d zapmass"
echo "  - Ou liste volumes: docker volume ls | grep zapmass"
exit 1
