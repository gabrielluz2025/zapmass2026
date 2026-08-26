#!/usr/bin/env bash
# Cutover produção → Evolution Go (VPS).
# Uso: cd /opt/zapmass && bash deployment/cutover-evolution-go.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

set_env() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^[[:space:]]*\\(export[[:space:]]\\+\\)\\?${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

echo "==> Cutover Evolution Go"
echo "    AVISO: todos os chips precisarão de novo QR (sessões Baileys não migram)."

bash deployment/ensure-evolution-go-dbs.sh

set_env ZAPMASS_WHATSAPP_ENGINE evolution-go
set_env EVOLUTION_GO_URL http://evolution-go:8080
set_env EVOLUTION_GO_REPLICAS 1
set_env EVOLUTION_NODE_REPLICAS 0

if [ -z "$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null || true)" ]; then
  api_key="$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
  if [ -n "$api_key" ]; then
    set_env EVOLUTION_GO_KEY "$api_key"
  fi
fi

echo "==> .env atualizado (engine=evolution-go)"

if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
  echo "==> Docker Swarm detectado — stack deploy"
  export $(grep -v '^#' "$ENV_FILE" | grep -E '^(ZAPMASS_|EVOLUTION_|POSTGRES_PASSWORD|HOST_PORT)=' | xargs) 2>/dev/null || true
  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
  docker service scale zapmass_evolution=0 2>/dev/null || true
  docker service update --force zapmass_api 2>/dev/null || true
else
  echo "==> Docker Compose"
  docker compose stop evolution 2>/dev/null || true
  docker compose up -d evolution-go postgres redis
  docker compose up -d --build zapmass
fi

echo ""
echo "==> Próximos passos:"
echo "  1. Ative licença Foundation: http://127.0.0.1:8081/manager"
echo "  2. Valide: curl -s http://127.0.0.1:3001/api/admin/evolution-engine (admin)"
echo "  3. Re-pareie CADA chip (QR) na UI ZapMass"
echo "  4. Pausar campanhas até chips online de novo"
