#!/usr/bin/env bash
# Otimização PostgreSQL evolution_db — índices SRE + ANALYZE + validação (idempotente).
# Corrige seq scans em Message (remoteJid) e IsOnWhatsapp conforme diagnóstico 2026-06-24.
#
# Uso:
#   cd /opt/zapmass && sudo bash deployment/vps-optimize-evolution-db.sh
#
# Variáveis:
#   PG_CONTAINER=zapmass-postgres-1
#   SKIP_ANALYZE=1

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-}"
DB="${EVOLUTION_DB:-evolution_db}"
LOG="${VPS_PG_OPT_LOG:-/var/log/zapmass-pg-optimize.log}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; BLD=$'\033[1m'; END=$'\033[0m'

log()  { echo "${CYN}[pg-opt]${END} $*"; tee -a "$LOG" 2>/dev/null || true; }
ok()   { echo "${GRN}[ok]${END} $*"; tee -a "$LOG" 2>/dev/null || true; }
warn() { echo "${YEL}[aviso]${END} $*" >&2; tee -a "$LOG" 2>/dev/null || true; }
err()  { echo "${RED}[erro]${END} $*" >&2; tee -a "$LOG" 2>/dev/null || true; }

find_pg() {
  if [ -n "$PG_CONTAINER" ] && docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    echo "$PG_CONTAINER"
    return 0
  fi
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres' | grep -E 'zapmass' | head -1 || true
}

psql_ev() {
  docker exec "$PG_C" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

psql_ev_quiet() {
  docker exec "$PG_C" psql -U postgres -d "$DB" -tAc "$1" 2>/dev/null || true
}

index_exists() {
  psql_ev_quiet "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='$1'" | grep -q 1
}

column_exists() {
  local table="$1" col="$2"
  psql_ev_quiet "
SELECT 1 FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = '${table}' AND a.attname = '${col}'
  AND a.attnum > 0 AND NOT a.attisdropped LIMIT 1;
" | grep -q 1
}

snapshot() {
  local label="$1"
  echo ""
  echo "${BLD}── ${label} ──${END}"
  date -Iseconds | tee -a "$LOG" 2>/dev/null || true
  uptime | tee -a "$LOG" 2>/dev/null || true
  docker stats --no-stream 2>/dev/null | head -6 | tee -a "$LOG" 2>/dev/null || true
  psql_ev -c "
SELECT pid, state, wait_event_type, left(query,100) AS q
FROM pg_stat_activity WHERE datname='${DB}' AND state='active' AND pid<>pg_backend_pid();
SELECT relname, seq_scan, idx_scan, n_live_tup
FROM pg_stat_user_tables
WHERE relname IN ('Message','IsOnWhatsapp','Contact','Chat')
ORDER BY relname;
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='Message'
ORDER BY indexname;
" 2>/dev/null | tee -a "$LOG" 2>/dev/null || true
}

run_concurrent_index() {
  local name="$1"
  local ddl="$2"
  if index_exists "$name"; then
    ok "  índice ${name} já existe"
    return 0
  fi
  log "  criando ${name} (CONCURRENTLY — pode levar 1–5 min)..."
  if docker exec "$PG_C" psql -U postgres -d "$DB" -c "$ddl"; then
    ok "  ${name} criado"
  else
    warn "  falha ao criar ${name} (pode já existir com outro nome)"
  fi
}

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
touch "$LOG" 2>/dev/null || LOG="/tmp/zapmass-pg-optimize.log"

echo ""
echo "${BLD}════════════════════════════════════════════════════════════${END}"
echo "${BLD}  ZapMass — otimização evolution_db (PostgreSQL)${END}"
echo "${BLD}════════════════════════════════════════════════════════════${END}"
echo ""

PG_C="$(find_pg)"
if [ -z "$PG_C" ]; then
  err "Container Postgres não encontrado."
  exit 1
fi
ok "Container: ${PG_C} / database: ${DB}"

snapshot "ANTES"

log "1/4 Índices Message (query rankedMessages / remoteJid)"

run_concurrent_index "idx_message_instance_timestamp" \
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_instance_timestamp ON "Message" ("instanceId", "messageTimestamp");'

run_concurrent_index "idx_message_remote_jid" \
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_remote_jid ON "Message" (("key"->>'\''remoteJid'\''));'

run_concurrent_index "idx_message_instance_remote_jid_ts" \
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_instance_remote_jid_ts ON "Message" ("instanceId", ("key"->>'\''remoteJid'\''), "messageTimestamp" DESC);'

log "2/4 Índices IsOnWhatsapp"
if column_exists "IsOnWhatsapp" "remoteJid"; then
  run_concurrent_index "idx_isonwhatsapp_remote_jid" \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_isonwhatsapp_remote_jid ON "IsOnWhatsapp" ("remoteJid");'
elif column_exists "IsOnWhatsapp" "jid"; then
  run_concurrent_index "idx_isonwhatsapp_jid" \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_isonwhatsapp_jid ON "IsOnWhatsapp" ("jid");'
else
  warn "  IsOnWhatsapp: coluna remoteJid/jid não encontrada — pulando (envie \\d \"IsOnWhatsapp\")"
fi

if column_exists "IsOnWhatsapp" "instanceId" && column_exists "IsOnWhatsapp" "remoteJid"; then
  run_concurrent_index "idx_isonwhatsapp_instance_remote_jid" \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_isonwhatsapp_instance_remote_jid ON "IsOnWhatsapp" ("instanceId", "remoteJid");'
fi

log "3/4 Índice Contact (lookup por instance + remoteJid — join frequente)"
if column_exists "Contact" "remoteJid"; then
  run_concurrent_index "idx_contact_instance_remote_jid" \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_instance_remote_jid ON "Contact" ("instanceId", "remoteJid");'
fi

if [ "${SKIP_ANALYZE:-0}" != "1" ]; then
  log "4/4 ANALYZE nas tabelas quentes"
  psql_ev -c 'ANALYZE "Message"; ANALYZE "IsOnWhatsapp"; ANALYZE "Contact"; ANALYZE "Chat";' \
    && ok "  ANALYZE concluído"
else
  warn "  SKIP_ANALYZE=1"
fi

log "Garantir Evolution Up (WhatsApp)"
if [ -f /opt/zapmass/docker-compose.yml ]; then
  (cd /opt/zapmass && docker compose up -d evolution) 2>/dev/null || true
fi

sleep 5
snapshot "DEPOIS"

echo ""
HC="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3001/api/health 2>/dev/null || echo 000)"
if [ "$HC" = "200" ]; then
  ok "API health HTTP 200"
else
  warn "API health HTTP ${HC}"
fi

echo ""
echo "${GRN}${BLD}Otimização evolution_db concluída.${END}"
echo "Log: ${LOG}"
echo ""
echo "Monitore 10–15 min: uptime && docker stats --no-stream"
echo "Repetir diagnóstico: sudo bash /opt/zapmass/deployment/vps-monitor-producao.sh"
echo ""
echo "Meta: zapmass-postgres-1 CPU < 80%, load 15min < 2.5"
