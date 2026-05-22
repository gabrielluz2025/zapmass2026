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
POSTGRES_PASSWORD="$(grep -E '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$ENV" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=//' | tr -d '\r"' | xargs || true)"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$DEFAULT_POSTGRES_PASSWORD}"
EVOLUTION_KEY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' "$ENV" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' || true)"
EVOLUTION_KEY="${EVOLUTION_KEY:-$DEFAULT_EVOLUTION_KEY}"
POSTGRES_HOST="${POSTGRES_HOST:-tasks.postgres}"

postgres_container_id() {
  docker ps -q --filter "name=zapmass_postgres" 2>/dev/null | head -1 || true
}

swarm_network() {
  local cid net
  cid="$(postgres_container_id)"
  if [ -n "$cid" ]; then
    net="$(docker inspect "$cid" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null | head -1 || true)"
    [ -n "$net" ] && printf '%s' "$net" && return 0
  fi
  docker network ls --format '{{.Name}}' | grep -E 'zapmass.*(internal|default)' | head -1 || true
}

verify_postgres_auth() {
  local cid
  cid="$(postgres_container_id)"
  [ -n "$cid" ] || return 1
  docker exec -e "PGPASSWORD=${POSTGRES_PASSWORD}" "$cid" \
    psql -h 127.0.0.1 -U postgres -d evolution_db -c 'SELECT 1' >/dev/null 2>&1
}

verify_postgres_auth_overlay() {
  local net
  net="$(swarm_network)"
  [ -n "$net" ] || return 1
  docker run --rm --network "$net" -e "PGPASSWORD=${POSTGRES_PASSWORD}" postgres:15-alpine \
    psql -h "${POSTGRES_HOST}" -U postgres -d evolution_db -c 'SELECT 1' >/dev/null 2>&1
}

wait_pg_isready() {
  local cid i
  for i in $(seq 1 30); do
    cid="$(postgres_container_id)"
    if [ -n "$cid" ] && docker exec "$cid" pg_isready -U postgres -d evolution_db -q 2>/dev/null; then
      ok "pg_isready OK (contentor postgres)"
      return 0
    fi
    sleep 3
  done

  # Fallback: rede overlay (DNS postgres no Swarm)
  local net
  net="$(swarm_network)"
  if [ -n "$net" ]; then
    for i in $(seq 1 15); do
      if docker run --rm --network "$net" postgres:15-alpine \
        pg_isready -h "${POSTGRES_HOST}" -U postgres -d evolution_db -q 2>/dev/null; then
        ok "pg_isready OK (rede ${net})"
        return 0
      fi
      sleep 2
    done
  fi
  return 1
}

sync_postgres_password() {
  local cid esc_pass
  cid="$(postgres_container_id)"
  [ -n "$cid" ] || return 1
  esc_pass="${POSTGRES_PASSWORD//\'/\'\'}"
  log "Alinhar senha do user postgres com POSTGRES_PASSWORD do .env"
  docker exec "$cid" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "ALTER USER postgres PASSWORD '${esc_pass}';" >/dev/null
  ok "Senha postgres actualizada"
}

diagnose_evolution() {
  echo ""
  echo "--- zapmass_evolution (tasks) ---"
  docker service ps zapmass_evolution --no-trunc 2>&1 | head -12 || true
  echo ""
  echo "--- zapmass_evolution (logs) ---"
  docker service logs zapmass_evolution --tail 50 2>&1 || true
}

restart_evolution() {
  local db_uri="postgresql://postgres:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:5432/evolution_db?schema=public"
  log "Parar Evolution"
  docker service scale zapmass_evolution=0 >/dev/null 2>&1 || true
  sleep 12
  log "Actualizar DATABASE_CONNECTION_URI na Evolution (${POSTGRES_HOST})"
  docker service update \
    --env-rm DATABASE_CONNECTION_URI \
    --env-add "DATABASE_CONNECTION_URI=${db_uri}" \
    zapmass_evolution >/dev/null 2>&1 || true
  log "Subir Evolution + force update"
  docker service scale zapmass_evolution=1 >/dev/null 2>&1 || true
  sleep 8
  docker service update --force zapmass_evolution >/dev/null 2>&1 || true
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

wait_evolution_http() {
  local i code="000"
  for i in $(seq 1 24); do
    code="$(curl -s -o /tmp/evolution-fetch.json -w '%{http_code}' \
      "http://127.0.0.1:8080/instance/fetchInstances" \
      -H "apikey: ${EVOLUTION_KEY}" 2>/dev/null || echo 000)"
    if [ "$code" = "200" ]; then
      printf '%s' "$code"
      return 0
    fi
    local ev_rep
    ev_rep="$(docker service ls --filter name=zapmass_evolution --format '{{.Replicas}}' 2>/dev/null || echo '')"
    echo "   evolution: ${ev_rep:-?} | HTTP ${code} (${i}/24)"
    if [ "$i" = "6" ] || [ "$i" = "12" ]; then
      diagnose_evolution
    fi
    sleep 10
  done
  printf '%s' "$code"
  return 1
}

wait_service_zero() {
  local name="$1"
  local max="${2:-30}"
  local i rep
  for i in $(seq 1 "$max"); do
    rep="$(docker service ls --filter "name=${name}" --format '{{.Replicas}}' 2>/dev/null || echo '')"
    if [ "$rep" = "0/0" ]; then
      return 0
    fi
    echo "   aguardar ${name} parar: ${rep:-?} (${i}/${max})"
    sleep 4
  done
  return 1
}

reset_evolution_db_volume() {
  warn "ZAPMASS_RESET_EVOLUTION_DB=1 — apagar volume zapmass_zapmass-postgres (instancias Evolution)"
  docker service scale zapmass_evolution=0 >/dev/null 2>&1 || true
  docker service scale zapmass_postgres=0 >/dev/null 2>&1 || true
  wait_service_zero zapmass_postgres 30 || warn "Postgres ainda nao parou totalmente"
  sleep 5
  if docker volume inspect zapmass_zapmass-postgres >/dev/null 2>&1; then
    docker volume rm -f zapmass_zapmass-postgres 2>/dev/null \
      || docker volume rm zapmass_zapmass-postgres 2>/dev/null \
      || true
  fi
  if docker volume inspect zapmass_zapmass-postgres >/dev/null 2>&1; then
    warn "Volume zapmass_zapmass-postgres ainda existe — pare servicos manualmente e remova"
    return 1
  fi
  ok "Volume postgres Evolution removido"
  docker service scale zapmass_postgres=1 >/dev/null 2>&1 || true
  wait_postgres_replicas 45 || return 1
  wait_pg_isready || return 1
  sync_postgres_password || true
  restart_evolution
  log "Aguardar Evolution HTTP 200 (ate 4 min)"
  http_code="$(wait_evolution_http || true)"
}

http_code="000"

log "Estado actual"
docker stack services zapmass 2>/dev/null || true
diagnose_postgres

if [ "${ZAPMASS_RESET_EVOLUTION_DB:-0}" = "1" ]; then
  reset_evolution_db_volume
else
  pg_rep="$(docker service ls --filter name=zapmass_postgres --format '{{.Replicas}}' 2>/dev/null || echo '')"
  if [ "$pg_rep" != "1/1" ]; then
    log "Force update zapmass_postgres"
    docker service update --force zapmass_postgres >/dev/null 2>&1 || true
    if ! wait_postgres_replicas 45; then
      warn "Postgres continua 0/1 apos force update"
      echo ""
      echo "Para reinicializar o banco Evolution (apaga sessoes WhatsApp da Evolution):"
      echo "  ZAPMASS_RESET_EVOLUTION_DB=1 bash deployment/recover-postgres-evolution.sh"
      exit 1
    fi
  else
    ok "Postgres ja 1/1"
  fi
  wait_pg_isready || warn "pg_isready falhou"
  sync_postgres_password || warn "Nao foi possivel alinhar senha postgres"
  if verify_postgres_auth; then
    ok "Postgres aceita login com POSTGRES_PASSWORD do .env"
  else
    warn "Login local falhou — tentar sync novamente"
    sync_postgres_password || true
    if verify_postgres_auth; then
      ok "Postgres aceita login apos segundo sync"
    else
      warn "Senha ainda falha no contentor — use ZAPMASS_RESET_EVOLUTION_DB=1"
    fi
  fi
  if verify_postgres_auth_overlay; then
    ok "Postgres acessivel na rede overlay (hostname postgres)"
  else
    warn "Overlay postgres:5432 falhou (Evolution pode ter P1001)"
  fi
  restart_evolution
  log "Aguardar Evolution HTTP 200 (ate 4 min)"
  http_code="$(wait_evolution_http || true)"
fi

if [ "$http_code" != "200" ]; then
  http_code="$(curl -s -o /tmp/evolution-fetch.json -w '%{http_code}' \
    "http://127.0.0.1:8080/instance/fetchInstances" \
    -H "apikey: ${EVOLUTION_KEY}" 2>/dev/null || echo 000)"
fi

echo ""
echo "========== RESUMO =========="
docker stack services zapmass 2>/dev/null || true
echo "Evolution HTTP: ${http_code}"

if [ "$http_code" = "200" ]; then
  ok "Evolution operacional."
  exit 0
fi

warn "Evolution ainda nao respondeu 200"
diagnose_evolution
echo ""
echo "Se logs mostram P1001, authentication failed ou Migration failed:"
echo "  ZAPMASS_RESET_EVOLUTION_DB=1 bash deployment/recover-postgres-evolution.sh"
exit 1
