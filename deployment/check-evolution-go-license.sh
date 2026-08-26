#!/usr/bin/env bash
# Verifica licença Evolution Go e orienta ativação (ou rollback temporário).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env}"
GO_KEY="$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
GO_KEY="${GO_KEY:-$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo zapmass-secure-key-2026)}"

echo "==> Evolution Go — status de licença"
echo ""

if ! curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/server/ok" >/dev/null 2>&1; then
  echo "ERRO: Evolution Go não responde em :8081"
  echo "  docker compose ps evolution-go  OU  docker service ps zapmass_evolution-go"
  exit 1
fi

echo "Container OK em http://127.0.0.1:8081"
echo ""
echo "==> GET /license/status"
curl -s -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/license/status" | head -c 800 || true
echo ""
echo ""

if curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/license/status" | grep -qiE '"active"[[:space:]]*:[[:space:]]*true|licensed'; then
  echo "OK: licença parece ATIVA — QR e delete devem funcionar."
  exit 0
fi

echo "AVISO: licença NÃO ativa (QR/delete retornam LICENSE_REQUIRED)."
echo ""
echo "Ativar agora:"
echo "  1. Na VPS: ssh -L 8081:127.0.0.1:8081 usuario@SEU_IP"
echo "  2. No PC: abra http://127.0.0.1:8081/manager"
echo "  3. Login + ative licença Foundation (Evolution)"
echo "  4. Volte ao ZapMass e clique Forçar QR"
echo ""
echo "Rollback temporário (volta Evolution API Node / Baileys):"
echo "  sed -i 's/^ZAPMASS_WHATSAPP_ENGINE=.*/ZAPMASS_WHATSAPP_ENGINE=evolution-api/' .env"
echo "  echo 'EVOLUTION_NODE_REPLICAS=1' >> .env && echo 'EVOLUTION_GO_REPLICAS=0' >> .env"
echo "  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth"
echo "  docker service update --force zapmass_api"
exit 1
