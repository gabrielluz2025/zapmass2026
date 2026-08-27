#!/usr/bin/env bash
# Alivia / previne "too many clients already" no Postgres compartilhado (prod + clientes + homolog).
# Uso: cd /opt/zapmass && bash deployment/fix-postgres-connections.sh
# Reinício do Postgres (aplica max_connections do compose): bash deployment/fix-postgres-connections.sh --restart-postgres
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
RESTART_PG=0
[ "${1:-}" = "--restart-postgres" ] && RESTART_PG=1

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

log "Conexões atuais:"
docker exec "$PG" psql -U postgres -d postgres -c \
  "SELECT state, count(*) FROM pg_stat_activity GROUP BY state ORDER BY count(*) DESC;" 2>/dev/null || true

docker exec "$PG" psql -U postgres -d postgres -c "SHOW max_connections;" 2>/dev/null || true

log "Parar evolution-go-homolog (evita loop de conexões)…"
docker stop zapmass-evolution-go-homolog 2>/dev/null || true

log "Encerrar conexões idle antigas (>3 min)…"
docker exec "$PG" psql -U postgres -d postgres -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND datname IS NOT NULL
  AND usename = 'postgres'
  AND state IN ('idle', 'idle in transaction')
  AND state_change < now() - interval '3 minutes';
" 2>/dev/null || true

log "Conexões após limpeza:"
docker exec "$PG" psql -U postgres -d postgres -c \
  "SELECT count(*) AS total FROM pg_stat_activity;" 2>/dev/null || true

if [ "$RESTART_PG" = "1" ]; then
  log "Reiniciar Postgres (aplica max_connections=300 do docker-compose)…"
  docker compose up -d postgres
  sleep 5
  docker exec "$PG" psql -U postgres -d postgres -c "SHOW max_connections;" 2>/dev/null || true
fi

log "OK — pode subir homolog: bash deployment/recover-homolog-evolution-go.sh"
