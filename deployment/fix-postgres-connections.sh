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
STOP_PROD_EVOLUTION=0
for arg in "$@"; do
  case "$arg" in
    --restart-postgres) RESTART_PG=1 ;;
    --aggressive) AGGRESSIVE=1 ;;
    --stop-prod-evolution) STOP_PROD_EVOLUTION=1 ;;
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

ensure_prod_evolution_running() {
  # Garante que o Evolution Go de PRODUÇÃO está no ar após a limpeza
  for cname in zapmass-evolution-go evolution-go-prod; do
    if docker inspect "$cname" >/dev/null 2>&1; then
      if ! docker ps --filter "name=^${cname}$" --filter "status=running" -q | grep -q .; then
        log "Reiniciando Evolution Go de produção (${cname}) que estava parado…"
        docker start "$cname" 2>/dev/null || true
      fi
      docker update --restart=always "$cname" >/dev/null 2>&1 || true
    fi
  done
}

stop_connection_hogs() {
  log "Parar consumidores Evolution HOMOLOG (libera slots Postgres)…"
  # SEGURO: para apenas homolog e containers de teste — NUNCA produção por padrão
  docker stop zapmass-evolution-go-homolog 2>/dev/null || true
  docker stop zapmass-homolog-evolution-go  2>/dev/null || true
  docker stop evolution-go-homolog          2>/dev/null || true
  # Produção só com flag explícita --stop-prod-evolution
  if [ "$STOP_PROD_EVOLUTION" = "1" ]; then
    log "AVISO: parando Evolution Go de PRODUÇÃO (--stop-prod-evolution fornecido)"
    docker stop zapmass-evolution-go 2>/dev/null || true
    docker stop evolution-go         2>/dev/null || true
  fi
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
  log "OK — Postgres aceita conexões."
  # Garante que o Evolution Go de produção não ficou parado por acidente
  ensure_prod_evolution_running
  log "Suba homolog se necessário: bash deployment/recover-homolog-evolution-go.sh"

  # Instala cron de limpeza preventiva de conexões idle (a cada 10 minutos)
  CRON_FILE="/etc/cron.d/zapmass-pg-cleanup"
  if [ ! -f "$CRON_FILE" ]; then
    log "Instalando cron de limpeza preventiva de conexões Postgres idle..."
    cat > "$CRON_FILE" << 'EOFCRON'
# Limpa conexões idle do Postgres a cada 10 minutos (previne "too many clients")
*/10 * * * * root docker exec zapmass-postgres-1 psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND state_change < NOW() - INTERVAL '5 minutes' AND pid <> pg_backend_pid();" > /var/log/zapmass-pg-cleanup.log 2>&1
EOFCRON
    chmod 644 "$CRON_FILE"
    log "Cron de limpeza instalado em $CRON_FILE (a cada 10 minutos)"
  fi
else
  echo "ERRO: Postgres ainda indisponível após limpeza/restart." >&2
  exit 1
fi
