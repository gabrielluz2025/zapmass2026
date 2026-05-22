#!/usr/bin/env bash
# Recupera Postgres + Evolution no Docker Swarm quando postgres fica 0/1.
# Uso: cd /opt/zapmass && bash deployment/recover-postgres-evolution.sh
# Reset total (apaga DB Evolution): ZAPMASS_RESET_EVOLUTION_DB=1 bash deployment/recover-postgres-evolution.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
DEFAULT_POSTGRES_PASSWORD="${DEFAULT_POSTGRES_PASSWORD:-evolution-secure-pass-2026}"
DEFAULT_EVOLUTION_KEY="${DEFAULT_EVOLUTION_KEY:-zapmass-secure-key-2026}"

log() { echo "==> $*"; }
ok() { echo "OK: $*"; }
warn() { echo "AVISO: $*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

cd "$ROOT"
POSTGRES_PASSWORD="$(grep -E '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$ENV" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=//' | tr -d '\r"' || true)"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$DEFAULT_POSTGRES_PASSWORD}"
EVOLUTION_KEY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' "$ENV" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' || true)"
EVOLUTION_KEY="${EVOLUTION_KEY:-$DEFAULT_EVOLUTION_KEY}"

swarm_network() {
  docker network ls --format '{{.Name}}' | grep -E '^zapmass(_default)?$' | head -1 || true
}

diagnose_postgres() {
  echo ""
  echo "--- zapmass_postgres (tasks) ---"
  docker service ps zapmass_postgres --no-trunc 2>&1 | head -12 || true
  echo ""
  echo "--- zapmass_postgres (logs) ---"
  docker service logs zapmass_postgres --tail 40 2>&1 || true
}

wait_postgres_replicas() {
  local max="${1:-60}"
  local i rep
  for i in $(seq 1 "$max"); do
    rep="$(docker service ls --filter name=zapmass_postgres --format '{{.Replicas}}' 2>/dev/null || echo '')"
    if [ "$rep" = "1/1" ]; then
      ok "Postgres replicas: 1/1"
      return 0
    fi
    echo "   postgres: ${rep:-?} (${i}/${max})"
    if [ "$i" = "15" ] || [ "$i" = "30" ]; then
      diagnose_postgres
    fi
    sleep 4
  done
  return 1
}

wait_pg_isready() {
  local net
  net="$(swarm_network)"
  [ -n "$net" ] || return 1
  local i
  for i in $(seq 1 30); do
    if docker run --rm --network "$net" -e "PGPASSWORD=${POSTGRES_PASSWORD}" postgres:15-alpine \
      pg_isready -h postgres -U postgres -d evolution_db -q 2>/dev/null; then
      ok "pg_isready OK"
      return 0
    fi
    sleep 3
  done
  return 1
}

reset_evolution_db_volume() {
  warn "ZAPMASS_RESET_EVOLUTION_DB=1 — apagar volume zapmass_zapmass-postgres (instancias Evolution)"
  docker service scale zapmass_evolution=0 >/dev/null 2>&1 || true
  docker service scale zapmass_postgres=0 >/dev/null 2>&1 || true
  sleep 12
  docker volume rm -f zapmass_zapmass-postgres 2>/dev/null \
    || docker volume rm zapmass_zapmass-postgres 2>/dev/null \
    || true
  docker service scale zapmass_postgres=1 >/dev/null 2>&1 || true
  wait_postgres_replicas 45 || return 1
  wait_pg_isready || return 1
  docker service scale zapmass_evolution=1 >/dev/null 2>&1 || true
  sleep 20
}

log "Estado actual"
docker stack services zapmass 2>/dev/null || true
diagnose_postgres

if [ "${ZAPMASS_RESET_EVOLUTION_DB:-0}" = "1" ]; then
  reset_evolution_db_volume
else
  log "Force update zapmass_postgres"
  docker service update --force zapmass_postgres >/dev/null 2>&1 || true
  if ! wait_postgres_replicas 45; then
    warn "Postgres continua 0/1 apos force update"
    echo ""
    echo "Para reinicializar o banco Evolution (apaga sessoes WhatsApp da Evolution):"
    echo "  ZAPMASS_RESET_EVOLUTION_DB=1 bash deployment/recover-postgres-evolution.sh"
    exit 1
  fi
  wait_pg_isready || warn "Postgres 1/1 mas pg_isready falhou (senha errada no .env?)"
  log "Reiniciar Evolution"
  docker service scale zapmass_evolution=0 >/dev/null 2>&1 || true
  sleep 8
  docker service scale zapmass_evolution=1 >/dev/null 2>&1 || true
  sleep 20
fi

http_code="$(curl -s -o /tmp/evolution-fetch.json -w '%{http_code}' \
  "http://127.0.0.1:8080/instance/fetchInstances" \
  -H "apikey: ${EVOLUTION_KEY}" 2>/dev/null || echo 000)"

echo ""
echo "========== RESUMO =========="
docker stack services zapmass 2>/dev/null || true
echo "Evolution HTTP: ${http_code}"

if [ "$http_code" = "200" ]; then
  ok "Evolution operacional."
  exit 0
fi

warn "Evolution ainda nao respondeu 200"
docker service logs zapmass_evolution --tail 50 2>&1 || true
exit 1
