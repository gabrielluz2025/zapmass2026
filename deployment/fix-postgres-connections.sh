#!/usr/bin/env bash
# Alivia / previne "too many clients already" no Postgres compartilhado (prod + clientes + homolog).
# Uso: cd /opt/zapmass && bash deployment/fix-postgres-connections.sh
# Agressivo (idle imediato + para API homolog): bash deployment/fix-postgres-connections.sh --aggressive
# Reinício do Postgres (aplica max_connections=300): bash deployment/fix-postgres-connections.sh --restart-postgres
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
RESTART_PG=0
AGGRESSIVE=0
for arg in "$@"; do
  case "$arg" in
    --restart-postgres) RESTART_PG=1 ;;
    --aggressive) AGGRESSIVE=1 ;;
  esac
done

log() { echo "==> $*"; }

pg_cid() {
  docker ps --format '{{.Names}}' | grep -E 'postgres' | head -1 || true
}

PG="$(pg_cid)"
if [ -z "$PG" ]; then
  echo "ERRO: container Postgres não encontrado" >&2
  exit 1
fi

log "Postgres: ${PG}"

pg_sql() {
  docker exec "$PG" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1
}

pg_can_connect() {
  docker exec "$PG" psql -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1
}

stop_connection_hogs() {
  log "Parar consumidores Evolution (libera slots Postgres)…"
  docker stop zapmass-evolution-go-homolog 2>/dev/null || true
  docker stop zapmass-evolution-go 2>/dev/null || true
  docker stop evolution-go 2>/dev/null || true
  if [ "$AGGRESSIVE" = "1" ] || [ "$RESTART_PG" = "1" ]; then
    docker stop zapmass-homolog-api 2>/dev/null || true
  fi
  sleep 2
}

terminate_idle() {
  local min_idle="${1:-3}"
  local states="'idle', 'idle in transaction'"
  if [ "$min_idle" = "0" ]; then
    log "Encerrar TODAS conexões postgres idle (modo agressivo)…"
  else
    log "Encerrar conexões idle antigas (>${min_idle} min)…"
  fi
  local time_filter=""
  if [ "$min_idle" != "0" ]; then
    time_filter="AND state_change < now() - interval '${min_idle} minutes'"
  fi
  pg_sql "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND datname IS NOT NULL
  AND usename = 'postgres'
  AND state IN (${states})
  ${time_filter};
" 2>/dev/null || true
}

show_stats() {
  log "Conexões atuais:"
  pg_sql "SELECT state, count(*) FROM pg_stat_activity GROUP BY state ORDER BY count(*) DESC;" 2>/dev/null || echo "  (psql indisponível — too many clients?)"
  pg_sql "SHOW max_connections;" 2>/dev/null || true
  pg_sql "SELECT count(*) AS total FROM pg_stat_activity;" 2>/dev/null || true
}

stop_connection_hogs
show_stats

if ! pg_can_connect; then
  log "AVISO: Postgres recusando novas conexões — modo agressivo automático"
  AGGRESSIVE=1
  terminate_idle 0
  sleep 2
fi

if [ "$AGGRESSIVE" != "1" ]; then
  terminate_idle 3
else
  terminate_idle 0
fi

sleep 1
log "Conexões após limpeza:"
pg_sql "SELECT count(*) AS total FROM pg_stat_activity;" 2>/dev/null || true

if ! pg_can_connect; then
  log "AVISO: ainda sem slot — reiniciando Postgres (breve indisponibilidade SQL)…"
  RESTART_PG=1
fi

if [ "$RESTART_PG" = "1" ]; then
  stop_connection_hogs
  log "Recriar Postgres com max_connections=300…"
  docker compose up -d --force-recreate postgres
  sleep 10
  PG="$(pg_cid)"
  if [ -n "$PG" ]; then
    pg_sql "SHOW max_connections;" 2>/dev/null || true
    pg_sql "SELECT count(*) AS total FROM pg_stat_activity;" 2>/dev/null || true
  fi
fi

if pg_can_connect; then
  log "OK — Postgres aceita conexões. Suba homolog: bash deployment/recover-homolog-evolution-go.sh"
else
  echo "ERRO: Postgres ainda indisponível após limpeza/restart." >&2
  exit 1
fi
