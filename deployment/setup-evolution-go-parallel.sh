#!/usr/bin/env bash
# Sobe Evolution Go em paralelo à Evolution API (sem cutover automático).
# Uso na VPS: cd /opt/zapmass && bash deployment/setup-evolution-go-parallel.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Subindo Evolution Go (profile evolution-go)..."
docker compose --profile evolution-go up -d evolution-go

echo "==> Aguardando /server/ok (até 90s)..."
for i in $(seq 1 30); do
  if curl -sf -H "apikey: ${EVOLUTION_GO_KEY:-${EVOLUTION_API_KEY:-zapmass-secure-key-2026}}" \
    "http://127.0.0.1:8081/server/ok" >/dev/null 2>&1; then
    echo "Evolution Go respondeu em http://127.0.0.1:8081"
    echo ""
    echo "Próximos passos:"
    echo "  1. Abra http://SEU_IP:8081/manager e ative a licença Foundation"
    echo "  2. Valide paridade: GET /api/admin/evolution-engine (com token admin)"
    echo "  3. Piloto: no .env defina ZAPMASS_WHATSAPP_ENGINE=evolution-go"
    echo "     EVOLUTION_GO_URL=http://evolution-go:8080"
    echo "  4. docker compose up -d --build zapmass"
    echo "  5. Re-pareie cada chip (QR) — sessões Baileys não migram"
    exit 0
  fi
  sleep 3
done

echo "WARN: Evolution Go ainda não respondeu. Verifique: docker compose logs evolution-go"
echo "Pode estar aguardando licença (503 até ativar no manager)."
exit 1
