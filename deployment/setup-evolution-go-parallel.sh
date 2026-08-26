#!/usr/bin/env bash
# Sobe Evolution Go e aplica cutover no .env (motor padrão).
# Uso na VPS: cd /opt/zapmass && bash deployment/setup-evolution-go-parallel.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash deployment/ensure-evolution-go-dbs.sh

echo "==> Subindo Evolution Go..."
docker compose up -d evolution-go 2>/dev/null || docker compose --profile evolution-go up -d evolution-go 2>/dev/null || true

if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active; then
  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth 2>/dev/null || true
fi

echo "==> Aguardando /server/ok (até 90s)..."
for i in $(seq 1 30); do
  if curl -sf -H "apikey: ${EVOLUTION_GO_KEY:-${EVOLUTION_API_KEY:-zapmass-secure-key-2026}}" \
    "http://127.0.0.1:8081/server/ok" >/dev/null 2>&1; then
    echo "Evolution Go respondeu em http://127.0.0.1:8081"
    echo ""
    echo "Para cutover completo (recomendado):"
    echo "  bash deployment/cutover-evolution-go.sh"
    echo ""
    echo "Ou manualmente no .env:"
    echo "  ZAPMASS_WHATSAPP_ENGINE=evolution-go"
    echo "  EVOLUTION_GO_URL=http://evolution-go:8080"
    echo "  docker compose up -d --build zapmass"
    exit 0
  fi
  sleep 3
done

echo "WARN: Evolution Go ainda não respondeu. Verifique: docker compose logs evolution-go"
echo "Pode estar aguardando licença (503 até ativar no manager)."
exit 1
