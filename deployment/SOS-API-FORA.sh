#!/usr/bin/env bash
# SOS: API fora (curl vazio / 0/1) — git pull + stack + Redis host + API sem force --image.
# Na VPS: cd /opt/zapmass && bash deployment/SOS-API-FORA.sh
set -euo pipefail
cd /opt/zapmass

log() { echo "==> $*"; }

log "1) Codigo mais recente"
git fetch --all --prune
git checkout -f main 2>/dev/null || git checkout -f origin/main
git pull --ff-only origin main 2>/dev/null || git checkout -f origin/main
log "commit $(git rev-parse --short HEAD)"

log "2) REDIS_URL (host.docker.internal — overlay Swarm quebrada)"
export REDIS_URL=redis://host.docker.internal:6379
if [ -f .env ]; then
  if grep -qE '^REDIS_URL=' .env; then
    sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://host.docker.internal:6379|' .env
  else
    echo 'REDIS_URL=redis://host.docker.internal:6379' >> .env
  fi
fi

log "3) Estado actual"
docker stack services zapmass 2>/dev/null || true
docker service ps zapmass_api --no-trunc 2>/dev/null | head -6 || true

log "4) Stack deploy (aplica extra_hosts + Redis :6379 no host)"
docker stack deploy -c docker-stack.yml zapmass --with-registry-auth

log "5) Redis no host"
for i in $(seq 1 20); do
  if timeout 2 bash -c 'echo > /dev/tcp/127.0.0.1/6379' 2>/dev/null; then
    log "Redis OK (tentativa $i)"
    break
  fi
  docker service update --force zapmass_redis 2>/dev/null || true
  echo "   aguardando Redis :6379 ($i/20)"
  sleep 4
done

log "6) API restart (sem --image)"
docker service update \
  --force \
  --update-order stop-first \
  --update-parallelism 1 \
  --update-delay 15s \
  --env-add REDIS_URL=redis://host.docker.internal:6379 \
  zapmass_api 2>/dev/null || true

log "7) Aguardar 1/1 + health (ate 8 min)"
HP="${HOST_PORT:-3001}"
for i in $(seq 1 80); do
  rep="$(docker service ls --filter name=zapmass_api --format '{{.Replicas}}' 2>/dev/null | head -1 || true)"
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HP}/api/health" 2>/dev/null || echo 000)"
  echo "   $i: replicas=${rep:-?} HTTP=${code}"
  if [ "${code}" = "200" ]; then
    echo ""
    curl -s "http://127.0.0.1:${HP}/api/version"
    echo ""
    CID="$(docker ps -q --filter name=zapmass_api | head -1 || true)"
    [ -n "${CID}" ] && docker exec "${CID}" printenv REDIS_URL 2>/dev/null || true
    echo ""
    log "OK: API no ar."
    exit 0
  fi
  if [ "${rep}" != "1/1" ] && [ "$((i % 10))" -eq 0 ]; then
    docker service ps zapmass_api --no-trunc 2>/dev/null | head -4 || true
  fi
  sleep 6
done

log "FALHOU — ultimos logs:"
docker service logs --tail 60 zapmass_api 2>&1 || true
echo ""
log "Tente rebuild completo: bash deployment/vps-deploy.sh"
exit 1
