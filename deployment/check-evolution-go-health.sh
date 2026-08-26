#!/usr/bin/env bash
# Health check Evolution Go + ZapMass API (VPS).
# Uso: cd /opt/zapmass && bash deployment/check-evolution-go-health.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

GO_KEY="$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
GO_KEY="${GO_KEY:-$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo zapmass-secure-key-2026)}"
ENGINE="$(grep -E '^ZAPMASS_WHATSAPP_ENGINE=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo evolution-go)"

fail=0
ok() { echo "OK: $*"; }
warn() { echo "AVISO: $*" >&2; }
bad() { echo "ERRO: $*" >&2; fail=1; }

echo "==> Evolution Go — health check"
echo "    engine=${ENGINE}"
echo ""

echo "==> docker compose ps (zapmass, evolution-go, redis, postgres)"
docker compose ps zapmass evolution-go redis postgres 2>/dev/null || docker compose ps
echo ""

echo "==> GET /server/ok (:8081)"
if curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/server/ok" >/dev/null; then
  ok "Evolution Go responde"
else
  bad "Evolution Go não responde em :8081"
fi

echo ""
echo "==> GET /license/status"
LICENSE_JSON="$(curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/license/status" || true)"
echo "${LICENSE_JSON}" | head -c 400
echo ""
if echo "$LICENSE_JSON" | grep -qiE '"status"[[:space:]]*:[[:space:]]*"active"'; then
  ok "Licença ativa"
else
  bad "Licença inativa ou ausente"
fi

echo ""
echo "==> GET /instance/all"
INST_JSON="$(curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/instance/all" || true)"
echo "${INST_JSON}" | head -c 1200
echo ""
INST_COUNT="$(echo "$INST_JSON" | grep -oE '"name"[[:space:]]*:' | wc -l | tr -d ' ')"
CONNECTED_COUNT="$(echo "$INST_JSON" | grep -oE '"connected"[[:space:]]*:[[:space:]]*true' | wc -l | tr -d ' ')"
echo "    instâncias: ${INST_COUNT:-0}, conectadas: ${CONNECTED_COUNT:-0}"
if [ "${INST_COUNT:-0}" -gt 0 ]; then
  ok "Há instância(s) registrada(s) no Go"
else
  warn "Nenhuma instância no Go — pareie QR na UI"
fi
if echo "$INST_JSON" | grep -qE '"webhook"[[:space:]]*:[[:space:]]*""'; then
  warn "Webhook vazio na instância Go — mensagens/eventos podem não chegar ao ZapMass (será corrigido no próximo hydrate/connect)"
fi

echo ""
echo "==> GET /api/health (ZapMass :3001)"
HEALTH="$(curl -sf "http://127.0.0.1:3001/api/health" || true)"
echo "${HEALTH}" | head -c 400
echo ""
if echo "$HEALTH" | grep -qi '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  ok "API ZapMass saudável"
else
  bad "API ZapMass não responde OK"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "==> Resultado: Evolution Go operacional"
  exit 0
fi
echo "==> Resultado: corrija os itens ERRO acima"
exit 1
