#!/usr/bin/env bash
# Correcao definitiva Evolution 0/1: recria DB Postgres da Evolution e sobe servicos.
# Uso: cd /opt/zapmass && bash deployment/fix-evolution-now.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
DEFAULT_POSTGRES_PASSWORD="${DEFAULT_POSTGRES_PASSWORD:-evolution-secure-pass-2026}"
DEFAULT_EVOLUTION_KEY="${DEFAULT_EVOLUTION_KEY:-zapmass-secure-key-2026}"

log() { echo "==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

cd "$ROOT"
chmod +x deployment/recover-postgres-evolution.sh 2>/dev/null || true

if [ -f "$ENV" ]; then
  grep -qE '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$ENV" \
    || printf '\nPOSTGRES_PASSWORD=%s\n' "$DEFAULT_POSTGRES_PASSWORD" >> "$ENV"
  grep -qE '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' "$ENV" \
    || printf 'EVOLUTION_API_KEY=%s\n' "$DEFAULT_EVOLUTION_KEY" >> "$ENV"
fi

log "Reinicializar Postgres Evolution + subir Evolution (pode demorar 5 min)"
export ZAPMASS_RESET_EVOLUTION_DB=1
exec bash "$ROOT/deployment/recover-postgres-evolution.sh"
