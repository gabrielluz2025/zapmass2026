#!/usr/bin/env bash
# Deploy na VPS: chamado pelo GitHub Actions após `git` em /opt/zapmass.
# Requer: GITHUB_EVENT_NAME (ex.: push, schedule, workflow_dispatch)
set -euo pipefail

cd /opt/zapmass

event="${GITHUB_EVENT_NAME:-push}"

# Janela segura: só no cron
if [ "$event" = "schedule" ]; then
  HOUR="$(date +%H)"
  if [ "$HOUR" -ge 6 ]; then
    echo "==> (cron) Fora da janela segura de deploy (agora: ${HOUR}h)."
    echo "==> (cron) Próximo ciclo do cron retoma."
    exit 0
  fi
fi

# Hash no bundle Vite
VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo ?)"
export VITE_GIT_REF
echo "==> VITE_GIT_REF=${VITE_GIT_REF} (commit deste deploy)"

# Repassa VITE_*, MERCADOPAGO_*, ZAPMASS_* e WA_WORKER_REPLICAS (interpolar docker-stack.yml)
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    k="${k//$'\r'/}"
    v="${v//$'\r'/}"
    case "$k" in
      VITE_*|MERCADOPAGO_*|ZAPMASS_*|WA_WORKER_REPLICAS)
        export "$k=$v"
        ;;
    esac
  done < <(grep -E '^[[:space:]]*(VITE_[A-Z0-9_]*|MERCADOPAGO_[A-Z0-9_]*|ZAPMASS_[A-Z0-9_]*|WA_WORKER_REPLICAS)=' .env || true)
  if [ -n "${MERCADOPAGO_ACCESS_TOKEN:-}" ]; then
    echo "==> MERCADOPAGO_ACCESS_TOKEN presente (prefixo ${MERCADOPAGO_ACCESS_TOKEN:0:14}…)"
  else
    echo "==> AVISO: MERCADOPAGO_ACCESS_TOKEN vazio após .env"
  fi
fi

# Build otimizado: cache de camadas e npm no host; evita re-download pesado
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export BUILDKIT_PROGRESS=plain

SWARM_ENABLED="${SWARM_ENABLED:-auto}"
IS_SWARM_MANAGER="0"
if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
  IS_SWARM_MANAGER="1"
fi

if [ "$SWARM_ENABLED" = "1" ] || { [ "$SWARM_ENABLED" = "auto" ] && [ "$IS_SWARM_MANAGER" = "1" ]; }; then
  echo "==> deploy em Docker Swarm (stack: zapmass)"
  docker build -t zapmass:latest \
    --build-arg VITE_ADMIN_EMAILS="${VITE_ADMIN_EMAILS:-}" \
    --build-arg VITE_MARKETING_PRICE_MONTHLY="${VITE_MARKETING_PRICE_MONTHLY:-}" \
    --build-arg VITE_MARKETING_PRICE_ANNUAL="${VITE_MARKETING_PRICE_ANNUAL:-}" \
    --build-arg VITE_ENFORCE_SUBSCRIPTION="${VITE_ENFORCE_SUBSCRIPTION:-}" \
    --build-arg VITE_CREATOR_STUDIO="${VITE_CREATOR_STUDIO:-}" \
    --build-arg VITE_GIT_REF="${VITE_GIT_REF}" \
    .
  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
  for svc in zapmass_api zapmass_wa-worker; do
    if docker service inspect "$svc" >/dev/null 2>&1; then
      echo "==> (swarm) forçar recriação: $svc"
      docker service update --force --image zapmass:latest "$svc" || docker service update --force "$svc" || true
    fi
  done
else
  echo "==> docker compose build + up"
  docker compose up -d --build
  if docker compose ps --services 2>/dev/null | grep -q '^zapmass$'; then
    echo "==> (compose) forçar recriação do serviço zapmass"
    docker compose up -d --no-deps --build --force-recreate zapmass
  fi
fi

if [ -d /opt/zapmass/clientes ] && ls /opt/zapmass/clientes/*/docker-compose.yml >/dev/null 2>&1; then
  echo "==> atualizar containers dos clientes"
  for dir in /opt/zapmass/clientes/*/; do
    slug="$(basename "$dir")"
    case "$slug" in
      *removido*) continue ;;
    esac
    [ -f "${dir}docker-compose.yml" ] || continue
    echo "    - cliente: ${slug}"
    (cd "$dir" && docker compose up -d)
  done
else
  echo "==> sem clientes adicionais"
fi

if [ "${PRUNE_AFTER_DEPLOY:-0}" = "1" ]; then
  echo "==> docker image prune (PRUNE_AFTER_DEPLOY=1)"
  docker image prune -f || true
else
  echo "==> prune desativado (cache de build preservado)"
fi

echo "==> status"
if [ "$SWARM_ENABLED" = "1" ] || { [ "$SWARM_ENABLED" = "auto" ] && [ "$IS_SWARM_MANAGER" = "1" ]; }; then
  docker stack services zapmass
else
  docker compose ps
fi
if [ -d /opt/zapmass/clientes ]; then
  docker ps --filter "name=^zapmass-cli-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
fi

# Healthcheck: até 5 min (com build grande a API demora a voltar 200)
echo "==> aguardando API /api/health"
for i in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health || echo 000)
  echo "tentativa $i: HTTP $code"
  if [ "$code" = "200" ]; then
    echo "OK: API saudável."
    exit 0
  fi
  sleep 6
done
echo "FALHA: API não respondeu 200 após 300s"
if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
  echo "==> docker service ps + logs (swarm)"
  docker service ps zapmass_api || true
  docker service logs --since 10m --tail 200 zapmass_api || true
else
  docker compose -f /opt/zapmass/docker-compose.yml ps || true
  docker compose -f /opt/zapmass/docker-compose.yml logs --tail=120 || true
fi
exit 1
