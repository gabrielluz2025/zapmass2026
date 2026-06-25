#!/usr/bin/env bash
# syncFullHistory + restart seguro (aguarda Evolution entre cada chip).
# Uso: cd /opt/zapmass && bash deployment/vps-sync-full-history-safe.sh
# Só settings (sem restart): SKIP_RESTART=1 bash deployment/vps-sync-full-history-safe.sh
set -eu

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

EVO="${EVOLUTION_API_URL:-http://127.0.0.1:8080}"
EVO="${EVO%/}"
SKIP_RESTART="${SKIP_RESTART:-0}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-120}"

SETTINGS_BODY='{"rejectCall":false,"msgCall":"","groupsIgnore":false,"alwaysOnline":false,"readMessages":false,"readStatus":false,"syncFullHistory":true}'

log() { echo "==> $*"; }

wait_evo() {
  local i
  for i in $(seq 1 36); do
    if curl -sf --max-time 4 "${EVO}/" >/dev/null 2>&1; then
      return 0
    fi
    echo "   aguardando Evolution (${i}/36)..."
    sleep 5
  done
  return 1
}

ensure_evo() {
  log "Subir evolution + dependências"
  docker compose up -d postgres redis evolution >/dev/null 2>&1 || true
  if wait_evo; then
    log "Evolution respondendo em ${EVO}"
    return 0
  fi
  log "Evolution OFF — últimos logs:"
  docker compose logs evolution --tail 50 2>&1 || true
  exit 1
}

read_api_key() {
  local cid key
  cid="$(docker compose ps -q evolution 2>/dev/null | head -1 || true)"
  if [ -n "$cid" ]; then
    key="$(docker exec "$cid" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)"
    [ -n "$key" ] && printf '%s' "$key" && return 0
  fi
  key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
    | sed 's/^["'\'']//;s/["'\'']$//' || true)"
  printf '%s' "${key:-zapmass-secure-key-2026}"
}

ensure_evo
API_KEY="$(read_api_key)"
log "API key prefix: ${API_KEY:0:8}..."

INST_JSON="$(curl -sS --max-time 30 "${EVO}/instance/fetchInstances" -H "apikey: ${API_KEY}")"
if ! echo "$INST_JSON" | grep -q '"name"'; then
  echo "ERR fetchInstances: ${INST_JSON:0:300}"
  exit 1
fi

log "Ativar syncFullHistory em todas as instâncias"
echo "$INST_JSON" | grep -oE '"name":"conn_[^"]+"' | cut -d'"' -f4 | sort -u | while read -r CONN; do
  [ -z "$CONN" ] && continue
  echo "   settings $CONN"
  curl -sS -X POST "${EVO}/settings/set/${CONN}" \
    -H "apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${SETTINGS_BODY}" >/dev/null || echo "   AVISO: settings falhou em $CONN"
done

log "Confirmar syncFullHistory:"
curl -sS "${EVO}/instance/fetchInstances" -H "apikey: ${API_KEY}" \
  | grep -oE '"name":"conn_[^"]+"|"syncFullHistory":(true|false)|"connectionStatus":"[^"]+"'

if [ "$SKIP_RESTART" = "1" ]; then
  log "SKIP_RESTART=1 — fim (sem restart)."
  exit 0
fi

log "Restart chips open (POST), um por vez, pausa ${SLEEP_BETWEEN}s"
echo "$INST_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else []
for r in rows:
    n = r.get('name') or ''
    st = str(r.get('connectionStatus') or '').lower()
    if n.startswith('conn_') and st == 'open':
        print(n)
" 2>/dev/null | sort -u | while read -r CONN; do
  [ -z "$CONN" ] && continue
  ensure_evo
  log "restart POST $CONN"
  curl -sS -X POST "${EVO}/instance/restart/${CONN}" -H "apikey: ${API_KEY}" || true
  echo ""
  log "pausa ${SLEEP_BETWEEN}s (histórico baixando)..."
  sleep "$SLEEP_BETWEEN"
  ensure_evo
done

log "Concluído. Rode: bash deployment/diagnose-evolution-chat.sh"
