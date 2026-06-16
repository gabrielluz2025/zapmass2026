#!/usr/bin/env bash
# Corrige REDIS_URL legado do Swarm (host.docker.internal) para Docker Compose.
# Uso: cd /opt/zapmass && bash deployment/fix-redis-url-compose.sh
set -euo pipefail
cd /opt/zapmass

echo "==> REDIS_URL antes:"
grep '^REDIS_URL=' .env 2>/dev/null || echo "(ausente)"

if grep -qE '^REDIS_URL=' .env 2>/dev/null; then
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|' .env
else
  echo 'REDIS_URL=redis://redis:6379' >> .env
fi

echo "==> REDIS_URL depois:"
grep '^REDIS_URL=' .env

echo "==> Recriando container zapmass (aplica novo .env)..."
docker compose up -d --force-recreate zapmass

echo "==> Aguardando 8s..."
sleep 8

echo "==> REDIS_URL no container:"
docker exec zapmass-zapmass-1 printenv REDIS_URL

HP="${HOST_PORT:-3001}"
echo "==> Health dispatch:"
curl -s "http://127.0.0.1:${HP}/api/health/dispatch" || true
echo ""
