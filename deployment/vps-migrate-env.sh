#!/usr/bin/env bash
# Idempotente: garante variáveis mínimas da migração VPS no /opt/zapmass/.env
set -euo pipefail
cd /opt/zapmass
[ -f .env ] || cp .env.example .env

set_kv() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" .env 2>/dev/null; then
    return 0
  fi
  echo "${key}=${val}" >> .env
  echo "==> adicionado ${key}"
}

JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)"
PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"' ' || echo 'evolution-secure-pass-2026')"

set_kv ZAPMASS_AUTH_PROVIDER vps
set_kv ZAPMASS_DATA_PROVIDER vps
set_kv VITE_USE_VPS_AUTH true
set_kv VITE_USE_VPS_DATA true
set_kv SWARM_ENABLED 0
if ! grep -qE '^ZAPMASS_JWT_SECRET=' .env 2>/dev/null; then
  set_kv ZAPMASS_JWT_SECRET "${JWT}"
fi
set_kv ZAPMASS_DATABASE_URL "postgresql://postgres:${PG_PASS}@postgres:5432/zapmass_db"

echo "==> Revise MERCADOPAGO_*, RESEND_*, chaves Firebase (se ainda precisar) e rode:"
echo "    bash deployment/manual-pull-deploy.sh"
