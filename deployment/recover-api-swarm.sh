#!/usr/bin/env bash
# Sobe zapmass_api quando ficou 0/1 após deploy (corrida Swarm / force --image).
set -euo pipefail
cd /opt/zapmass

echo "==> actualizar codigo"
git fetch --all --prune 2>/dev/null || true
if [ -n "${GHA_SHA:-}" ]; then
  echo "==> checkout commit deploy ${GHA_SHA}"
  git checkout -f "${GHA_SHA}" 2>/dev/null || exit 1
else
  git checkout -f main 2>/dev/null || git checkout -f origin/main 2>/dev/null || true
  git pull --ff-only origin main 2>/dev/null || git checkout -f "$(git rev-parse origin/main 2>/dev/null || echo main)"
fi

if [ -f .env ] && grep -qE '^REDIS_URL=' .env 2>/dev/null; then
  if ! grep -q 'host.docker.internal' .env 2>/dev/null; then
    echo "==> corrigindo REDIS_URL no .env"
    sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://host.docker.internal:6379|' .env
  fi
fi
export REDIS_URL=redis://host.docker.internal:6379

echo "==> estado actual"
docker stack services zapmass 2>/dev/null || true
docker service ps zapmass_api --no-trunc 2>/dev/null | head -8 || true

echo "==> Redis host"
timeout 2 bash -c 'echo > /dev/tcp/127.0.0.1/6379' && echo "OK: 127.0.0.1:6379" || echo "AVISO: Redis host indisponivel"

echo "==> restart zapmass_api (sem --image)"
docker service update \
  --force \
  --update-order stop-first \
  --update-parallelism 1 \
  --update-delay 15s \
  --env-add REDIS_URL=redis://host.docker.internal:6379 \
  zapmass_api

echo "==> aguardando API 1/1 (ate 5 min)"
for i in $(seq 1 50); do
  rep="$(docker service ls --filter name=zapmass_api --format '{{.Replicas}}' 2>/dev/null | head -1 || true)"
  echo "  tentativa ${i}: ${rep:-?}"
  if [ "${rep}" = "1/1" ]; then
    break
  fi
  sleep 6
done

echo "==> health"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HOST_PORT:-3001}/api/health" || echo 000)"
  echo "  HTTP ${code}"
  if [ "${code}" = "200" ]; then
    curl -s "http://127.0.0.1:${HOST_PORT:-3001}/api/version" || true
    echo
    CID="$(docker ps -q --filter name=zapmass_api | head -1 || true)"
    if [ -n "${CID}" ]; then
      docker exec "${CID}" printenv REDIS_URL || true
    fi
    exit 0
  fi
  sleep 6
done

echo "ERRO: API ainda nao responde. Logs:"
docker service logs --tail 80 zapmass_api 2>&1 || true
exit 1
