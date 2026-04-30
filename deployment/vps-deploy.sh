#!/usr/bin/env bash
# Deploy na VPS: chamado pelo GitHub Actions após `git` em /opt/zapmass.
# Requer: GITHUB_EVENT_NAME (ex.: push, schedule, workflow_dispatch)
set -euo pipefail

cd /opt/zapmass

event="${GITHUB_EVENT_NAME:-push}"

# Janela segura: só no cron. Hora do relógio do host (muitas VPS = UTC; use TZ=... no systemd/cron se quiser fuso local).
if [ "$event" = "schedule" ]; then
  HOUR="$(date +%H)"
  if [ "$HOUR" -ge 6 ]; then
    echo "==> (cron) Fora da janela segura de deploy (agora: ${HOUR}h no relógio do host)."
    echo "==> (cron) Próximo ciclo do cron retoma."
    exit 0
  fi
fi

# Hash no bundle Vite
VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo ?)"
export VITE_GIT_REF
echo "==> VITE_GIT_REF=${VITE_GIT_REF} (commit deste deploy)"

# Repassa VITE_*, MERCADOPAGO_*, ZAPMASS_*, WWEBJS_WEB_VERSION_URL, HOST_PORT, FIREBASE_WEB_API_KEY… (ver .env.example)
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    k="${k//$'\r'/}"
    v="${v//$'\r'/}"
    case "$k" in
      VITE_*|MERCADOPAGO_*|ZAPMASS_*|HOST_PORT|METRICS_TOKEN|WA_WORKER_REPLICAS|ENSURE_SWAP_ON_DEPLOY|BUILDKIT_MAX_PARALLELISM|SWAP_SIZE_MB|SUBSCRIPTION_ENFORCE|ADMIN_EMAILS|FIREBASE_WEB_API_KEY|MAX_STAFF_PASSWORD_ACCOUNTS|WWEBJS_WEB_VERSION_URL)
        export "$k=$v"
        ;;
    esac
  done < <(grep -E '^[[:space:]]*(VITE_[A-Z0-9_]*|MERCADOPAGO_[A-Z0-9_]*|ZAPMASS_[A-Z0-9_]*|HOST_PORT|METRICS_TOKEN|WA_WORKER_REPLICAS|ENSURE_SWAP_ON_DEPLOY|BUILDKIT_MAX_PARALLELISM|SWAP_SIZE_MB|SUBSCRIPTION_ENFORCE|ADMIN_EMAILS|FIREBASE_WEB_API_KEY|MAX_STAFF_PASSWORD_ACCOUNTS|WWEBJS_WEB_VERSION_URL)=' .env || true)
  if [ -n "${MERCADOPAGO_ACCESS_TOKEN:-}" ]; then
    echo "==> MERCADOPAGO_ACCESS_TOKEN presente (prefixo ${MERCADOPAGO_ACCESS_TOKEN:0:14}…)"
  else
    echo "==> AVISO: MERCADOPAGO_ACCESS_TOKEN vazio após .env"
  fi
  if [ -n "${WWEBJS_WEB_VERSION_URL:-}" ]; then
    echo "==> WWEBJS_WEB_VERSION_URL exportada (${WWEBJS_WEB_VERSION_URL:0:88}…)"
  fi
fi

# Converte RAM em pico: swap idempotente (4 GiB) se total < alvo; desligar: ENSURE_SWAP_ON_DEPLOY=0
ensure_swap_on_vps() {
  if [ "${ENSURE_SWAP_ON_DEPLOY:-1}" = "0" ]; then
    return 0
  fi
  if [ ! -f deployment/ensure-swap.sh ]; then
    return 0
  fi
  if [ ! -r /proc/meminfo ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    env SWAP_SIZE_MB="${SWAP_SIZE_MB:-4096}" bash deployment/ensure-swap.sh || echo "==> AVISO: ensure-swap.sh falhou (disco? espaço?)."
  elif command -v sudo >/dev/null 2>&1; then
    sudo env SWAP_SIZE_MB="${SWAP_SIZE_MB:-4096}" bash deployment/ensure-swap.sh || echo "==> AVISO: ensure-swap.sh falhou (configure sudo sem senha p/ o utilizador de deploy, ou crie swap manualmente)."
  else
    echo "==> AVISO: ensure-swap.sh requer root/sudo; defina swap manualmente em VPS de ~4 GiB."
  fi
}
ensure_swap_on_vps

# Menos paralelismo no build = picos de RAM menores (útil com ~8 GiB + Chromium)
if [ -z "${BUILDKIT_MAX_PARALLELISM:-}" ] && [ -r /proc/meminfo ]; then
  _mem_mb="$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo)"
  if [ "${_mem_mb}" -le 8192 ]; then
    export BUILDKIT_MAX_PARALLELISM=1
  elif [ "${_mem_mb}" -le 16384 ]; then
    export BUILDKIT_MAX_PARALLELISM=2
  fi
  unset _mem_mb
fi
if [ -n "${BUILDKIT_MAX_PARALLELISM:-}" ]; then
  echo "==> BUILDKIT_MAX_PARALLELISM=${BUILDKIT_MAX_PARALLELISM} (podes definir no .env)"
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
    --build-arg VITE_ENFORCE_SUBSCRIPTION="${VITE_ENFORCE_SUBSCRIPTION:-true}" \
    --build-arg VITE_CREATOR_STUDIO="${VITE_CREATOR_STUDIO:-}" \
    --build-arg VITE_GIT_REF="${VITE_GIT_REF}" \
    .
  docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
  # Swarm: duas "service update" em sequência podem falhar com "update out of sequence" — retentar e espaçar.
  swarm_update_retry() {
    local svc=$1
    local a
    for a in 1 2 3 4 5 6; do
      if docker service update --force --image zapmass:latest "$svc" 2>/dev/null; then
        echo "==> (swarm) $svc actualizado (tentativa $a)."
        return 0
      fi
      echo "==> (swarm) $svc falhou (tentativa $a/6; ex.: conflito de versao). Aguardar 12s…"
      sleep 12
    done
    echo "==> AVISO: $svc nao actualizado apos 6 tentativas. Tente: docker service update --force --image zapmass:latest $svc" >&2
    return 1
  }
  for svc in zapmass_api zapmass_wa-worker; do
    if docker service inspect "$svc" >/dev/null 2>&1; then
      echo "==> (swarm) forçar recriação: $svc"
      swarm_update_retry "$svc" || true
      sleep 6
    fi
  done
  # Só alterar ficheiros em deployment/swarm/*.yml no host não recria a tarefa: força reload das regras do Prometheus.
  if docker service inspect zapmass_prometheus >/dev/null 2>&1; then
    echo "==> (swarm) forçar recarregamento: zapmass_prometheus (alert_rules.yml / prometheus.yml no host)"
    docker service update --force zapmass_prometheus >/dev/null 2>&1 || true
  fi
else
  echo "==> docker compose build + up"
  docker compose up -d --build
  if docker compose ps --services 2>/dev/null | grep -q '^zapmass$'; then
    echo "==> (compose) forçar recriação do serviço zapmass"
    docker compose up -d --no-deps --build --force-recreate zapmass
  fi
  if docker compose --profile workers ps --services --status running 2>/dev/null | grep -q '^wa-worker$'; then
    echo "==> (compose) forçar recriação do serviço wa-worker (profile workers)"
    docker compose --profile workers up -d --no-deps --build --force-recreate wa-worker
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
HP="${HOST_PORT:-3001}"
echo "==> aguardando API /api/health (porta publicada: ${HP})"
for i in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HP}/api/health" || echo 000)
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
