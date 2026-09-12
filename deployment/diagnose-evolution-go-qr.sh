#!/usr/bin/env bash
# Diagnóstico QR / instâncias Evolution Go + logs recentes ZapMass.
# Uso: cd /opt/zapmass && bash deployment/diagnose-evolution-go-qr.sh [connectionId]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"
CONN_FILTER="${1:-}"

GO_KEY="$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
GO_KEY="${GO_KEY:-$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo zapmass-secure-key-2026)}"

echo "==> Health rápido"
bash deployment/check-evolution-go-health.sh || true
echo ""

echo "==> Instâncias NÃO conectadas no Go (/instance/all → .data[])"
INST_JSON="$(curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/instance/all" || echo '{"data":[]}')"
if command -v jq >/dev/null 2>&1; then
  _OFF="$(echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then . else [] end | .[] | select(.connected != true) | "\(.name // .instanceName // "?") connected=\(.connected) jid=\(.jid // "-") reason=\(.disconnect_reason // "-") qrcode_len=\(.qrcode // "" | length)"' 2>/dev/null || true)"
  if [ -n "${_OFF}" ]; then
    echo "${_OFF}"
  else
    echo "OK: todas as instâncias no Go estão connected=true (ou lista vazia)."
  fi
else
  echo "$INST_JSON" | head -c 2000
fi
echo ""

if [ -n "$CONN_FILTER" ]; then
  echo "==> POST connect + GET qr para instância: $CONN_FILTER"
  curl -sf -X POST -H "apikey: ${GO_KEY}" -H "Content-Type: application/json" \
    -d '{"forceReconnect":true}' "http://127.0.0.1:8081/instance/connect/${CONN_FILTER}" | head -c 400 || echo "(connect falhou)"
  echo ""
  curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/instance/qr/${CONN_FILTER}" | head -c 400 || echo "(qr vazio ou erro)"
  echo ""
fi

echo "==> docker compose logs evolution-go --tail=120"
docker compose logs evolution-go --tail=120 2>&1 | tail -120
echo ""

echo "==> docker compose logs zapmass --tail=200 (QR / create / kick / licença)"
docker compose logs zapmass --tail=400 2>&1 | grep -iE 'kickEvolution|kick Go|Criando instância|Forçando novo QR|fetchConnectQr|connection-init-failure|LICENSE|criar canal|Instância criada|forceQr' || echo "(nenhuma linha filtrada — tente Forçar QR/novo canal e rode de novo)"
