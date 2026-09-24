#!/usr/bin/env bash
# Inspeciona / purga jobs BullMQ campaign-messages via API localhost (processo zapmass).
# Uso na VPS:
#   bash deployment/campaign-queue-vps.sh summary
#   bash deployment/campaign-queue-vps.sh summary --campaign <campaignId>
#   bash deployment/campaign-queue-vps.sh dry-run <campaignId>
#   bash deployment/campaign-queue-vps.sh purge <campaignId>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"
PORT="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
PORT="${PORT:-3001}"
BASE="http://127.0.0.1:${PORT}"

cmd="${1:-summary}"
shift || true

case "$cmd" in
  summary)
    QS=""
    if [ -n "${1:-}" ] && [ "${1:-}" = "--campaign" ]; then
      CID="${2:-}"
      QS="?campaignId=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${CID}'))")"
    fi
    curl -sf "${BASE}/api/internal/campaign-queue/summary${QS}" | python3 -m json.tool
    ;;
  dry-run)
    CID="${1:-}"
    if [ -z "$CID" ]; then
      echo "Uso: $0 dry-run <campaignId>" >&2
      exit 1
    fi
    curl -sf -X POST "${BASE}/api/internal/campaign-queue/purge" \
      -H 'Content-Type: application/json' \
      -d "{\"campaignId\":\"${CID}\",\"dryRun\":true}" | python3 -m json.tool
    ;;
  purge)
    CID="${1:-}"
    if [ -z "$CID" ]; then
      echo "Uso: $0 purge <campaignId>" >&2
      exit 1
    fi
    echo "AVISO: remove jobs waiting/delayed/paused da campanha e pausa a campanha na RAM."
    echo "Confirm phrase: PURGE ${CID}"
    read -r -p "Digite exatamente a frase acima: " phrase
    if [ "$phrase" != "PURGE ${CID}" ]; then
      echo "Confirmação incorreta — abortado." >&2
      exit 1
    fi
    curl -sf -X POST "${BASE}/api/internal/campaign-queue/purge" \
      -H 'Content-Type: application/json' \
      -d "{\"campaignId\":\"${CID}\",\"dryRun\":false,\"confirm\":\"PURGE ${CID}\",\"pauseFirst\":true}" | python3 -m json.tool
    ;;
  *)
    echo "Comandos: summary [--campaign id] | dry-run <campaignId> | purge <campaignId>" >&2
    exit 1
    ;;
esac
