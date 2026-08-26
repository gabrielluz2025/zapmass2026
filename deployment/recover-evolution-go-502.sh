#!/usr/bin/env bash
# Recupera site (502) após cutover Evolution Go: sobe Go, garante API, valida health.
# Uso na VPS: cd /opt/zapmass && bash deployment/recover-evolution-go-502.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

HP="$(grep -E '^HOST_PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \"'"'"'' || echo 3001)"
HP="${HP:-3001}"
GO_KEY="$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
GO_KEY="${GO_KEY:-$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo zapmass-secure-key-2026)}"

health_ok() {
  curl -sf --max-time 8 "http://127.0.0.1:${HP}/api/health" | grep -q '"status":"ok"'
}

echo "==> Recover Evolution Go + API (porta ${HP})"

bash deployment/ensure-evolution-go-dbs.sh || true

if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active; then
  echo "==> Swarm: stack deploy"
  export $(grep -v '^#' "$ENV_FILE" | grep -E '^(ZAPMASS_|EVOLUTION_|POSTGRES_|HOST_PORT)=' | sed 's/^[[:space:]]*export[[:space:]]*//' | xargs) 2>/dev/null || true
  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
  echo "==> Aguardando evolution-go (8081)…"
  for i in $(seq 1 40); do
    if curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/server/ok" >/dev/null 2>&1; then
      echo "Evolution Go OK"
      break
    fi
    sleep 3
  done
  docker service update --force zapmass_api 2>/dev/null || true
else
  echo "==> Compose"
  docker compose up -d evolution-go postgres redis zapmass
fi

echo "==> Aguardando API health…"
for i in $(seq 1 60); do
  if health_ok; then
    echo "OK: API respondeu /api/health"
    curl -s "http://127.0.0.1:${HP}/api/health" | head -c 400 || true
    echo ""
    echo ""
    echo "Próximo passo: licença em http://127.0.0.1:8081/manager e re-QR de cada chip."
    exit 0
  fi
  sleep 5
done

echo "ERRO: API ainda sem health 200 — rollback temporário para Evolution API Node"
if grep -qE '^ZAPMASS_WHATSAPP_ENGINE=' "$ENV_FILE"; then
  sed -i 's/^ZAPMASS_WHATSAPP_ENGINE=.*/ZAPMASS_WHATSAPP_ENGINE=evolution-api/' "$ENV_FILE"
else
  echo "ZAPMASS_WHATSAPP_ENGINE=evolution-api" >> "$ENV_FILE"
fi
echo "EVOLUTION_NODE_REPLICAS=1" >> "$ENV_FILE"
echo "EVOLUTION_GO_REPLICAS=0" >> "$ENV_FILE"

if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active; then
  export ZAPMASS_WHATSAPP_ENGINE=evolution-api EVOLUTION_NODE_REPLICAS=1 EVOLUTION_GO_REPLICAS=0
  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
  docker service update --force zapmass_api
else
  docker compose --profile evolution-api up -d evolution
  docker compose up -d --build zapmass
fi

echo "Rollback aplicado. Site deve voltar; planeje cutover Go novamente após licenciar."
exit 1
