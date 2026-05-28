#!/usr/bin/env bash
# Corrige Evolution P1001 no Swarm: redeploy stack (tasks.postgres) + reinicia Evolution.
# Uso: cd /opt/zapmass && bash deployment/fix-evolution-now.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"

log() { echo "==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

cd "$ROOT"
chmod +x deployment/vps-deploy.sh deployment/recover-postgres-evolution.sh 2>/dev/null || true

log "Deploy stack Swarm (rede overlay + tasks.postgres)"
bash deployment/vps-deploy.sh

EVOLUTION_KEY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' /opt/zapmass/.env 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' || true)"
EVOLUTION_KEY="${EVOLUTION_KEY:-zapmass-secure-key-2026}"
sleep 15
http_code="$(curl -s -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:8080/instance/fetchInstances" \
  -H "apikey: ${EVOLUTION_KEY}" 2>/dev/null || echo 000)"
ev_rep="$(docker service ls --filter name=zapmass_evolution --format '{{.Replicas}}' 2>/dev/null || echo '')"
pg_rep="$(docker service ls --filter name=zapmass_postgres --format '{{.Replicas}}' 2>/dev/null || echo '')"

if [ "$http_code" = "200" ] && [ "$ev_rep" = "1/1" ] && [ "$pg_rep" = "1/1" ]; then
  log "Evolution ja operacional (HTTP 200)"
  if [ -f "$ROOT/deployment/sync-client-evolution-env.sh" ]; then
    chmod +x "$ROOT/deployment/sync-client-evolution-env.sh" 2>/dev/null || true
    bash "$ROOT/deployment/sync-client-evolution-env.sh" || true
  fi
  docker stack services zapmass
  exit 0
fi

log "Evolution HTTP ${http_code} | evolution ${ev_rep} | postgres ${pg_rep} — recuperar"
bash deployment/recover-postgres-evolution.sh
