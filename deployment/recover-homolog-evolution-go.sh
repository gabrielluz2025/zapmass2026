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

if [ -f deployment/fix-postgres-connections.sh ]; then
  chmod +x deployment/fix-postgres-connections.sh 2>/dev/null || true
  bash deployment/fix-postgres-connections.sh || true
fi

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
      echo "  ERRO: não conecta em $db — rode: bash deployment/fix-postgres-connections.sh --aggressive --restart-postgres"
      bash deployment/fix-postgres-connections.sh --aggressive --restart-postgres || true
      PG_CID="$(docker ps --format '{{.Names}}' | grep -E 'postgres' | head -1 || true)"
      if ! docker exec "$PG_CID" psql -U postgres -d "$db" -c 'SELECT 1' >/dev/null 2>&1; then
        echo "ERRO: Postgres ainda indisponível para ${db}" >&2
        exit 1
      fi
      echo "  OK: $db (após recuperação Postgres)"
    fi
  done
fi

log "Logs evolution-go-homolog (últimas 40 linhas):"
docker logs zapmass-evolution-go-homolog --tail 40 2>&1 || true

log "Recrear evolution-go-homolog…"
export POSTGRES_PASSWORD="${PG_PASS:-evolution-secure-pass-2026}"
docker compose -f "$COMPOSE_FILE" --env-file "$HOMOLOG_ENV" up -d --force-recreate --no-deps evolution-go-homolog

sleep 8
GO_KEY="${EVOLUTION_GO_KEY_HOMOLOG:-}"
if [ -z "$GO_KEY" ] && [ -f "$HOMOLOG_ENV" ]; then
  GO_KEY="$(grep -E '^EVOLUTION_GO_KEY_HOMOLOG=' "$HOMOLOG_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
fi
GO_KEY="${GO_KEY:-zapmass-homolog-key-2026}"
GO_PORT="${HOMOLOG_EVOLUTION_PORT:-8082}"
if [ -f "$HOMOLOG_ENV" ]; then
  _port="$(grep -E '^HOMOLOG_EVOLUTION_PORT=' "$HOMOLOG_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
  [ -n "$_port" ] && GO_PORT="$_port"
fi
GO_BASE="http://127.0.0.1:${GO_PORT}"

go_responds() {
  curl -sf -H "apikey: ${GO_KEY}" "${GO_BASE}/server/ok" >/dev/null 2>&1 \
    || curl -sf -H "apikey: ${GO_KEY}" "${GO_BASE}/license/status" >/dev/null 2>&1
}

if ! go_responds; then
  log "AVISO: Evolution Go homolog não responde em :${GO_PORT} — verifique logs acima"
  docker logs zapmass-evolution-go-homolog --tail 30 2>&1 || true
  exit 1
fi

LICENSE_JSON="$(curl -s -H "apikey: ${GO_KEY}" "${GO_BASE}/license/status" 2>/dev/null || true)"
if echo "$LICENSE_JSON" | grep -qiE '"status"[[:space:]]*:[[:space:]]*"active"|"active"[[:space:]]*:[[:space:]]*true|"licensed"[[:space:]]*:[[:space:]]*true'; then
  log "Evolution Go homolog OK em :${GO_PORT} (licença ativa)"
  curl -sf -H "apikey: ${GO_KEY}" "${GO_BASE}/instance/all" | head -c 200 || true
  echo ""
  log "OK"
  exit 0
fi

log "Evolution Go homolog UP em :${GO_PORT} — licença inativa, tentando auto-ativação…"
if [ -f deployment/activate-homolog-evolution-license.sh ]; then
  chmod +x deployment/activate-homolog-evolution-license.sh 2>/dev/null || true
  EMAIL="$(grep -E '^EVOLUTION_OPERATOR_EMAIL=' "$HOMOLOG_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
  if bash deployment/activate-homolog-evolution-license.sh ${EMAIL:+"$EMAIL"}; then
    log "OK — licença homolog ativada"
    exit 0
  fi
fi

log "AVISO: licença homolog ainda inativa — chips WhatsApp indisponíveis até corrigir"
echo ""
echo "  Manual: ssh -L ${GO_PORT}:127.0.0.1:${GO_PORT} root@SEU_IP_VPS"
echo "  Browser: http://127.0.0.1:${GO_PORT}/manager/login"
echo "  Ou: bash deployment/activate-homolog-evolution-license.sh seu@email.com"
echo "  Teste: curl -s -H \"apikey: \$(grep EVOLUTION_GO_KEY_HOMOLOG homolog/.env | cut -d= -f2-)\" ${GO_BASE}/instance/all"
echo ""
exit 1
