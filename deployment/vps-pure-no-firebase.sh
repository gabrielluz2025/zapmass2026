#!/usr/bin/env bash
# ZapMass 100% VPS — sem Firebase (auth + dados Postgres).
# Uso: cd /opt/zapmass && bash deployment/vps-pure-no-firebase.sh
#      ZAPMASS_RESET_DATA=1 bash deployment/vps-pure-no-firebase.sh  # apaga dados zapmass (começar do zero)
set -euo pipefail
cd /opt/zapmass
[ -f .env ] || cp .env.example .env

upsert_env() {
  local k="$1" v="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env 2>/dev/null; then
    grep -vE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env > .env.tmp && mv .env.tmp .env
  fi
  echo "${k}=${v}" >> .env
  echo "  ${k}=${v}"
}

echo "=============================================="
echo " ZapMass — modo 100% VPS (sem Firebase)"
echo "=============================================="

JWT="$(grep -E '^ZAPMASS_JWT_SECRET=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"' ' || true)"
if [ -z "$JWT" ]; then
  JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)"
fi
PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"' ' || echo 'evolution-secure-pass-2026')"

echo ""
echo "==> .env"
upsert_env ZAPMASS_AUTH_PROVIDER vps
upsert_env ZAPMASS_DATA_PROVIDER vps
upsert_env VITE_USE_VPS_AUTH true
upsert_env VITE_USE_VPS_DATA true
upsert_env ZAPMASS_JWT_SECRET "${JWT}"
upsert_env ZAPMASS_DATABASE_URL "postgresql://postgres:${PG_PASS}@postgres:5432/zapmass_db"
upsert_env SWARM_ENABLED 0

if [ "${ZAPMASS_RESET_DATA:-0}" = "1" ]; then
  echo ""
  echo "==> ZAPMASS_RESET_DATA=1 — limpar schema zapmass (contas e dados)"
  docker compose exec -T postgres psql -U postgres -d zapmass_db -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS zapmass CASCADE;
CREATE SCHEMA zapmass;
SQL
  echo "    schema zapmass recriado (vazio)"
fi

chmod +x deployment/*.sh 2>/dev/null || true
export VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo ""
echo "==> Deploy (VITE_GIT_REF=${VITE_GIT_REF})"
bash deployment/manual-pull-deploy.sh

# Opcional: migração legado Firestore (ignorada se auth=vps e sem tenants no Firebase)
if [ "${ZAPMASS_AUTH_PROVIDER:-vps}" = "vps" ] && [ "${SKIP_FIRESTORE_MIGRATE:-1}" != "0" ]; then
  echo "==> Migração Firestore ignorada (modo VPS puro)"
else
  if [ -f secrets/firebase-admin.json ]; then
    docker compose exec -T zapmass npx tsx server/migrateFirestoreToVps.ts 2>/dev/null || true
  else
    echo "    (sem firebase-admin.json — ignorado)"
  fi
fi

echo ""
bash deployment/vps-check-env.sh
echo ""
echo "Pronto. Crie a primeira conta em: ${PUBLIC_APP_URL:-https://zap-mass.com}"
echo "Admin plataforma: use ADMIN_EMAILS no .env (e-mail da conta que registar)."
