#!/usr/bin/env bash
# Idempotente: garante variáveis mínimas da migração VPS no /opt/zapmass/.env
set -euo pipefail
cd /opt/zapmass
[ -f .env ] || cp .env.example .env

upsert_env() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" .env 2>/dev/null; then
    grep -vE "^[[:space:]]*(export[[:space:]]+)?${key}=" .env > .env.tmp && mv .env.tmp .env
  fi
  echo "${key}=${val}" >> .env
  echo "==> ${key}=${val}"
}

JWT="$(grep -E '^ZAPMASS_JWT_SECRET=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"' ' || true)"
[ -z "$JWT" ] && JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)"
PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"' ' || echo 'evolution-secure-pass-2026')"

upsert_env ZAPMASS_AUTH_PROVIDER vps
upsert_env ZAPMASS_DATA_PROVIDER vps
upsert_env VITE_USE_VPS_AUTH true
upsert_env VITE_USE_VPS_DATA true
upsert_env SWARM_ENABLED 0
upsert_env ZAPMASS_JWT_SECRET "${JWT}"
upsert_env ZAPMASS_DATABASE_URL "postgresql://postgres:${PG_PASS}@postgres:5432/zapmass_db"

echo "==> Modo 100% VPS (sem Firebase). Deploy: bash deployment/manual-pull-deploy.sh"
echo "==> Começar do zero: ZAPMASS_RESET_DATA=1 bash deployment/vps-pure-no-firebase.sh"
