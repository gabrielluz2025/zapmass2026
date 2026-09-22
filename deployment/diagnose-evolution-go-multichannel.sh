#!/usr/bin/env bash
# Diagnóstico Evolution Go multi-canal + CPU/carga da VPS.
# Uso: cd /opt/zapmass && bash deployment/diagnose-evolution-go-multichannel.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

GO_KEY="$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
GO_KEY="${GO_KEY:-$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo zapmass-secure-key-2026)}"

echo "========== $(date -Iseconds) =========="
echo ""

echo "==> 1) Carga / CPU / memória"
NPROC="$(nproc 2>/dev/null || echo '?')"
echo "CPUs: ${NPROC}"
uptime || true
if [ -r /proc/loadavg ]; then
  echo -n "loadavg: "; cat /proc/loadavg
fi
free -h 2>/dev/null | head -3 || true
echo ""
echo "Top 10 por CPU:"
ps aux --sort=-%cpu 2>/dev/null | head -11 || true
echo ""

echo "==> 2) Docker stats (1 amostra)"
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null | head -20 || true
  echo ""
  docker compose ps zapmass evolution-go redis postgres 2>/dev/null || docker compose ps 2>/dev/null | head -20 || true
fi
echo ""

echo "==> 3) Evolution Go — latência /instance/all + resumo multi-canal"
START_MS="$(date +%s%3N 2>/dev/null || date +%s)000"
START_MS="${START_MS:0:13}"
INST_JSON="$(curl -sf --max-time 15 -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/instance/all" || echo '')"
END_MS="$(date +%s%3N 2>/dev/null || date +%s)000"
END_MS="${END_MS:0:13}"
if [ -z "$INST_JSON" ]; then
  echo "ERRO: /instance/all falhou ou vazio (Go down / apikey / timeout)"
else
  ELAPSED=$((END_MS - START_MS))
  echo "Latência /instance/all: ${ELAPSED}ms"
  if command -v jq >/dev/null 2>&1; then
    TOTAL="$(echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then length else 0 end' 2>/dev/null || echo 0)"
    ON="$(echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then [.[] | select(.connected == true)] | length else 0 end' 2>/dev/null || echo 0)"
    OFF="$(echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then [.[] | select(.connected != true)] | length else 0 end' 2>/dev/null || echo 0)"
    ZOMBIE="$(echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then [.[] | select(.connected != true and (.jid // "") != "")] | length else 0 end' 2>/dev/null || echo 0)"
    echo "Instâncias: total=${TOTAL} connected=${ON} offline=${OFF} zumbis(jid sem connected)=${ZOMBIE}"
    echo ""
    echo "Offline / connecting:"
    echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then .[] | select(.connected != true) | "\(.name // .instanceName // "?") connected=\(.connected) jid=\(.jid // "-") reason=\(.disconnect_reason // "-")" else empty end' 2>/dev/null | head -40 || true
    echo ""
    echo "Connected (amostra 20):"
    echo "$INST_JSON" | jq -r '(.data // .) | if type == "array" then .[] | select(.connected == true) | "\(.name // .instanceName // "?") ok" else empty end' 2>/dev/null | head -20 || true
  else
    echo "(instale jq para resumo detalhado)"
    echo "$INST_JSON" | head -c 800
    echo ""
  fi
fi
echo ""

echo "==> 4) Health HTTP Go + ZapMass"
curl -sf --max-time 5 "http://127.0.0.1:8081/server/ok" >/dev/null && echo "OK: Go /server/ok" || echo "ERRO: Go /server/ok"
API_VER="$(curl -sf --max-time 5 "http://127.0.0.1:3001/api/version" 2>/dev/null || true)"
if [ -n "$API_VER" ]; then
  echo "ZapMass /api/version: $API_VER"
else
  echo "AVISO: /api/version sem resposta"
fi
echo ""

echo "==> 5) Logs recentes (erros Go / fila / health)"
docker compose logs evolution-go --tail=40 2>&1 | tail -40 || true
echo "---"
docker compose logs zapmass --tail=80 2>&1 | grep -iE 'TrustScore|Health reconcile|reconnect_storm|limite|abortado|CPU|OOM|circuit|QUARENTENA|Redis indispon' | tail -40 || echo "(sem linhas filtradas)"
echo ""

echo "Fim. Interpretação rápida:"
echo "  • loadavg >> CPUs → CPU saturado; veja docker stats (zapmass / evolution-go)."
echo "  • muitos zumbis → rode cleanup / Forçar QR nos offline."
echo "  • latência /instance/all > 2000ms → Go sob pressão (muitos chips ou probes)."
echo "  • versao API antiga → redeploy: DEPLOY_FORCE=1 bash deployment/manual-pull-deploy.sh"
