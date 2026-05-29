#!/usr/bin/env bash
# Migra de Docker Swarm para Docker Compose (nó único).
# Swarm overlay quebrado (EHOSTUNREACH Redis) — Compose usa bridge networks sem esse problema.
# Volumes (dados, sessões, Redis) são PRESERVADOS.
#
# Uso: cd /opt/zapmass && bash deployment/migrar-swarm-para-compose.sh
set -euo pipefail
cd /opt/zapmass

log() { echo "==> $*"; }
ok()  { echo "OK: $*"; }

log "1) Código mais recente"
git fetch --all --prune
git checkout -f main 2>/dev/null || git checkout -f origin/main
git pull --ff-only origin main 2>/dev/null || true
log "commit $(git rev-parse --short HEAD)"

log "2) Desativar Swarm no .env (SWARM_ENABLED=0)"
if grep -qE '^SWARM_ENABLED=' .env 2>/dev/null; then
  sed -i 's/^SWARM_ENABLED=.*/SWARM_ENABLED=0/' .env
else
  echo 'SWARM_ENABLED=0' >> .env
fi

log "3) REDIS_URL para Compose (bridge DNS: redis:6379)"
if grep -qE '^REDIS_URL=' .env 2>/dev/null; then
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|' .env
else
  echo 'REDIS_URL=redis://redis:6379' >> .env
fi

log "4) Parar e remover stack Swarm (volumes preservados)"
if docker stack ls 2>/dev/null | grep -q '^zapmass '; then
  docker stack rm zapmass 2>/dev/null || true
  log "aguardando containers Swarm pararem (60s)..."
  for i in $(seq 1 30); do
    running=$(docker ps --filter name=zapmass_ -q 2>/dev/null | wc -l)
    echo "   containers ainda rodando: ${running}"
    [ "${running}" = "0" ] && break
    sleep 2
  done
fi

log "4b) Forçar remoção de redes overlay órfãs"
sleep 5
for net in $(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v ingress || true); do
  echo "   removendo rede overlay: ${net}"
  docker network rm "${net}" 2>/dev/null || true
done

log "5) Build + Compose up"
export DOCKER_BUILDKIT=1
export VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo compose)"
docker compose build \
  --build-arg CACHEBUST="${VITE_GIT_REF}" \
  --build-arg VITE_GIT_REF="${VITE_GIT_REF}" \
  zapmass 2>&1 | tail -5

docker compose up -d zapmass redis evolution postgres

log "6) Aguardar API responder (ate 5 min)"
HP="${HOST_PORT:-3001}"
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HP}/api/health" 2>/dev/null || echo 000)"
  echo "   tentativa ${i}: HTTP ${code}"
  if [ "${code}" = "200" ]; then
    echo ""
    curl -s "http://127.0.0.1:${HP}/api/version"
    echo ""
    docker compose ps --format 'table {{.Name}}\t{{.Status}}'
    echo ""
    ok "API no ar via Docker Compose."
    ok "Redis: redis://redis:6379 (bridge network — sem overlay)."
    ok "Próximos deploys do GitHub Actions usam Compose (SWARM_ENABLED=0 no .env)."
    exit 0
  fi
  sleep 5
done

log "FALHOU — logs:"
docker compose logs --tail 60 zapmass 2>&1 || true
log "Docker Compose ps:"
docker compose ps || true
exit 1
