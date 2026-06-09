#!/usr/bin/env bash
# Diagnóstico / correção de ownerUid em connections_settings.json (vazamento entre tenants).
#
# Na VPS:
#   cd /opt/zapmass && bash deployment/diagnose-connection-owners.sh
#   cd /opt/zapmass && bash deployment/diagnose-connection-owners.sh --json
#   cd /opt/zapmass && bash deployment/diagnose-connection-owners.sh --fix conn_XXX firebaseUid [--prior uidErrado]
#
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

CID="$(docker ps -q -f name=zapmass-api 2>/dev/null | head -1 || true)"
if [ -z "$CID" ]; then
  CID="$(docker ps -q -f name=api 2>/dev/null | head -1 || true)"
fi

if [ -n "$CID" ]; then
  echo "==> diagnose (container $CID)"
  exec docker exec -e DATA_DIR=/app/data "$CID" npm run diagnose:connection-owners -- "$@"
fi

echo "==> diagnose (host, DATA_DIR=$ROOT/data)"
export DATA_DIR="${DATA_DIR:-$ROOT/data}"
exec npm run diagnose:connection-owners -- "$@"
