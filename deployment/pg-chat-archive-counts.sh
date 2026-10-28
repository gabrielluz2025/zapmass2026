#!/usr/bin/env bash
# Contagens do arquivo de bate-papo (schema zapmass) — execute na VPS:
#   cd /opt/zapmass && bash deployment/pg-chat-archive-counts.sh
#
# Credenciais: o .env da VPS usa ZAPMASS_DATABASE_URL e POSTGRES_PASSWORD; POSTGRES_USER/POSTGRES_DB
# ficam fixos no docker-compose (postgres/postgres, DB inicial evolution_db). Tabelas wa_chat_* estão em zapmass_db.
# Ops: WA_FULL_INBOX_SYNC=0 só desliga sync em massa ao conectar; historySyncTriggered:false em loadChatHistory
# indica sobretudo GO_BOOTSTRAP_CHAT_MESSAGES=0 ou HistorySync não pedido (cooldown/falha), não WA_FULL_INBOX_SYNC sozinho.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
PGUSER="${PGUSER:-postgres}"
PGDB="${PGDB:-zapmass_db}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^(ZAPMASS_DATABASE_URL|POSTGRES_PASSWORD)=' "$ENV_FILE" | sed -E 's/^[[:space:]]*export[[:space:]]+//' || true)
  set +a
fi

if [[ -n "${ZAPMASS_DATABASE_URL:-}" ]]; then
  _url="${ZAPMASS_DATABASE_URL}"
  _url="${_url#postgresql://}"
  _url="${_url#postgres://}"
  if [[ "$_url" == *@* ]]; then
    _userpass="${_url%%@*}"
    _rest="${_url#*@}"
    PGUSER="${_userpass%%:*}"
  else
    _rest="$_url"
  fi
  _path="${_rest#*/}"
  _path="${_path%%\?*}"
  if [[ -n "$_path" ]]; then
    PGDB="$_path"
  fi
fi

PG_CTR="$(docker ps -qf 'name=zapmass-postgres' | head -1)"
if [[ -z "$PG_CTR" ]]; then
  echo "Erro: container postgres (zapmass-postgres*) não encontrado." >&2
  exit 1
fi

echo "==> PGUSER=${PGUSER} PGDB=${PGDB} (container=${PG_CTR})"

docker exec "$PG_CTR" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'wa_chat_messages' AS table_name, COUNT(*)::bigint AS row_count FROM zapmass.wa_chat_messages
UNION ALL
SELECT 'wa_chat_threads', COUNT(*)::bigint FROM zapmass.wa_chat_threads;
SQL
