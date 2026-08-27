#!/usr/bin/env bash
# Diagnóstico + recuperação Evolution Go homolog.
# Uso: cd /opt/zapmass && bash deployment/recover-homolog-evolution-go.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
COMPOSE_FILE="${ROOT}/docker-compose.homolog.yml"
HOMOLOG_ENV="${ROOT}/homolog/.env"

log() { echo "==> $*"; }

[ -f "$COMPOSE_FILE" ] || { echo "ERRO: docker-compose.homolog.yml não encontrado"; exit 1; }

bash deployment/ensure-homolog-dbs.sh

PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' "$HOMOLOG_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
if [ -z "$PG_PASS" ] && [ -f .env ]; then
  PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
PG_CID="$(docker ps --format '{{.Names}}' | grep -E 'postgres' | head -1 || true)"

if [ -n "$PG_CID" ] && [ -n "$PG_PASS" ]; then
  log "Testar Postgres evogo_homolog_*…"
  for db in evogo_homolog_auth evogo_homolog_users; do
    if docker exec "$PG_CID" psql -U postgres -d "$db" -c 'SELECT 1' >/dev/null 2>&1; then
      echo "  OK: $db"
    else
      echo "  ERRO: não conecta em $db"
    fi
  done
fi

log "Logs evolution-go-homolog (últimas 40 linhas):"
docker logs zapmass-evolution-go-homolog --tail 40 2>&1 || true

log "Recrear evolution-go-homolog…"
export POSTGRES_PASSWORD="${PG_PASS:-evolution-secure-pass-2026}"
docker compose -f "$COMPOSE_FILE" --env-file "$HOMOLOG_ENV" up -d --force-recreate --no-deps evolution-go-homolog

sleep 8
if curl -sf -H "apikey: ${EVOLUTION_GO_KEY_HOMOLOG:-zapmass-homolog-key-2026}" "http://127.0.0.1:${HOMOLOG_EVOLUTION_PORT:-8082}/instance/fetchInstances" >/dev/null 2>&1; then
  log "Evolution Go homolog respondeu em :8082"
else
  log "AVISO: Evolution Go ainda não responde — verifique logs acima"
  docker logs zapmass-evolution-go-homolog --tail 30 2>&1 || true
  exit 1
fi

log "OK"
