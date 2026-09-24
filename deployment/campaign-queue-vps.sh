#!/usr/bin/env bash
# Inspeciona / purga jobs BullMQ campaign-messages via API internal (processo zapmass).
# Chamadas via `docker compose exec` — curl do host em :3001 não é loopback dentro do container.
#
# Uso na VPS (substitua pelo ID real do summary, ex.: camp_abc123 — não digite "<campaignId>"):
#   bash deployment/campaign-queue-vps.sh summary
#   bash deployment/campaign-queue-vps.sh summary --campaign camp_abc123
#   bash deployment/campaign-queue-vps.sh dry-run camp_abc123
#   bash deployment/campaign-queue-vps.sh purge camp_abc123
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"
INTERNAL_PORT="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
INTERNAL_PORT="${INTERNAL_PORT:-3001}"
API_BASE="http://127.0.0.1:${INTERNAL_PORT}"

json_pretty() {
  python3 -m json.tool 2>/dev/null || cat
}

# curl dentro do container zapmass (remoteAddress = loopback para a API Node)
api_curl() {
  local method="${1:-GET}"
  local path="$2"
  local data="${3:-}"
  local raw
  raw="$(docker compose exec -T zapmass curl -sS -w $'\n__HTTP__%{http_code}' \
    -X "$method" \
    -H 'Content-Type: application/json' \
    ${data:+-d "$data"} \
    "${API_BASE}${path}" 2>&1)" || {
    echo "ERRO: falha ao executar curl no container zapmass (docker compose ps?)" >&2
    return 1
  }
  local http_code
  http_code="${raw##*$'\n__HTTP__'}"
  local body
  body="${raw%$'\n__HTTP__'*}"
  if [ "$http_code" != "200" ]; then
    echo "HTTP ${http_code} em ${path}" >&2
    echo "$body" >&2
    return 1
  fi
  printf '%s' "$body"
}

cmd="${1:-summary}"
shift || true

case "$cmd" in
  summary)
    QS=""
    if [ "${1:-}" = "--campaign" ]; then
      CID="${2:-}"
      if [ -z "$CID" ]; then
        echo "Uso: $0 summary --campaign <id-da-campanha>" >&2
        exit 1
      fi
      QS="?campaignId=$(python3 - "$CID" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1]))
PY
)"
    fi
    api_curl GET "/api/internal/campaign-queue/summary${QS}" | json_pretty
    ;;
  dry-run)
    CID="${1:-}"
    if [ -z "$CID" ]; then
      echo "Uso: $0 dry-run <id-da-campanha>" >&2
      echo "Ex.: bash $0 dry-run camp_xxxxxxxx" >&2
      exit 1
    fi
    PAYLOAD="$(python3 -c "import json; print(json.dumps({'campaignId':'${CID}','dryRun':True}))")"
    api_curl POST "/api/internal/campaign-queue/purge" "$PAYLOAD" | json_pretty
    ;;
  purge)
    CID="${1:-}"
    if [ -z "$CID" ]; then
      echo "Uso: $0 purge <id-da-campanha>" >&2
      exit 1
    fi
    echo "AVISO: remove jobs waiting/delayed/paused da campanha e pausa a campanha na RAM."
    echo "Confirm phrase: PURGE ${CID}"
    read -r -p "Digite exatamente a frase acima: " phrase
    if [ "$phrase" != "PURGE ${CID}" ]; then
      echo "Confirmação incorreta — abortado." >&2
      exit 1
    fi
    PAYLOAD="$(python3 -c "import json; print(json.dumps({'campaignId':'${CID}','dryRun':False,'confirm':'PURGE ${CID}','pauseFirst':True}))")"
    api_curl POST "/api/internal/campaign-queue/purge" "$PAYLOAD" | json_pretty
    ;;
  *)
    echo "Comandos: summary [--campaign id] | dry-run <id> | purge <id>" >&2
    exit 1
    ;;
esac
