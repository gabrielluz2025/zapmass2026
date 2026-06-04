#!/usr/bin/env bash
# Deploy na VPS: chamado pelo GitHub Actions após `git` em /opt/zapmass.
# Requer: GITHUB_EVENT_NAME (ex.: push, schedule, workflow_dispatch)
set -euo pipefail

cd /opt/zapmass

# Evita dois deploys em paralelo (GitHub Actions + manual).
_deploy_lock="/var/lock/zapmass-deploy.lock"
mkdir -p /var/lock 2>/dev/null || true
exec 9>"${_deploy_lock}"
_flock_wait="${DEPLOY_FLOCK_WAIT_SEC:-600}"
_flock_i=0
while ! flock -n 9; do
  _flock_i=$((_flock_i + 1))
  if [ "${_flock_i}" -gt "${_flock_wait}" ]; then
    echo "ERRO: outro deploy ZapMass ainda em execução após ${_flock_wait}s (${_deploy_lock})."
    echo "==> Diagnóstico: bash deployment/deploy-lock-diagnose.sh"
    echo "==> Se não houver deploy ativo: bash deployment/clear-stale-deploy-lock.sh"
    echo "==> Depois: bash deployment/manual-pull-deploy.sh"
    exit 1
  fi
  if [ "${_flock_i}" = "1" ] || [ $((_flock_i % 30)) -eq 0 ]; then
    echo "==> aguardando lock de deploy (${_flock_i}s / ${_flock_wait}s)…"
  fi
  sleep 1
done
unset _flock_wait _flock_i

# Garante que o arquivo .env existe para não quebrar o docker stack deploy/compose que o exige em env_file
if [ ! -f .env ]; then
  echo "==> AVISO: .env não encontrado em /opt/zapmass! Criando um arquivo .env padrão a partir de .env.example..."
  cp .env.example .env
fi

event="${GITHUB_EVENT_NAME:-push}"

# Janela segura: só no cron. Hora UTC (alinha com horários do GitHub Actions schedule).
if [ "$event" = "schedule" ]; then
  HOUR="$(date -u +%H)"
  if [ "$HOUR" -ge 6 ]; then
    echo "==> (cron) Fora da janela segura de deploy (agora: ${HOUR}h UTC)."
    echo "==> (cron) Próximo ciclo do cron retoma."
    exit 0
  fi
fi

# Hash no bundle Vite
VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo ?)"
export VITE_GIT_REF
echo "==> VITE_GIT_REF=${VITE_GIT_REF} (commit deste deploy)"

# Repassa VITE_*, MERCADOPAGO_*, ZAPMASS_*, TRUST_PROXY, WWEBJS_WEB_VERSION_URL… (ver .env.example)
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    k="${k//$'\r'/}"
    v="${v//$'\r'/}"
    v="${v#\"}"
    v="${v%\"}"
    v="${v#\'}"
    v="${v%\'}"
    case "$k" in
      VITE_*|MERCADOPAGO_*|ZAPMASS_*|HOST_PORT|METRICS_TOKEN|WA_WORKER_REPLICAS|WA_SYNC_CONV_EMIT_EVERY|WA_FULL_INBOX_SYNC|WA_CHAT_ARCHIVE|ENSURE_SWAP_ON_DEPLOY|BUILDKIT_MAX_PARALLELISM|SWAP_SIZE_MB|SUBSCRIPTION_ENFORCE|ADMIN_EMAILS|FIREBASE_WEB_API_KEY|MAX_STAFF_PASSWORD_ACCOUNTS|WWEBJS_WEB_VERSION_URL|TRUST_PROXY|TRUST_PROXY_HOPS|EVOLUTION_*|CONFIG_SESSION_PHONE_*|EVOLUTION_IMAGE|EVOLUTION_SERVER_URL|EVOLUTION_QRCODE_LIMIT|EVOLUTION_LOG_LEVEL|WPP_LID_MODE|CHAT_INBOX_*|POSTGRES_PASSWORD|RESEND_API_KEY|EMAIL_FROM|EMAIL_REPLY_TO|SUGGESTION_NOTIFY_EMAIL|NEW_CLIENT_NOTIFY_EMAIL|PUBLIC_APP_URL|ALLOWED_ORIGINS|SWARM_ENABLED|REDIS_URL)
        export "$k=$v"
        ;;
    esac
  # Aceitar também `export VAR=...` (sem isso o grep não apanha a linha e o Swarm fica sem MERCADOPAGO/FIREBASE/etc.).
  done < <(grep -E '^[[:space:]]*(export[[:space:]]+)?(VITE_[A-Z0-9_]*|MERCADOPAGO_[A-Z0-9_]*|ZAPMASS_[A-Z0-9_]*|HOST_PORT|METRICS_TOKEN|WA_WORKER_REPLICAS|WA_SYNC_CONV_EMIT_EVERY|WA_FULL_INBOX_SYNC|WA_CHAT_ARCHIVE|ENSURE_SWAP_ON_DEPLOY|BUILDKIT_MAX_PARALLELISM|SWAP_SIZE_MB|SUBSCRIPTION_ENFORCE|ADMIN_EMAILS|FIREBASE_WEB_API_KEY|MAX_STAFF_PASSWORD_ACCOUNTS|WWEBJS_WEB_VERSION_URL|TRUST_PROXY|TRUST_PROXY_HOPS|EVOLUTION_[A-Z0-9_]*|CONFIG_SESSION_PHONE_[A-Z0-9_]*|EVOLUTION_IMAGE|EVOLUTION_SERVER_URL|EVOLUTION_QRCODE_LIMIT|EVOLUTION_LOG_LEVEL|WPP_LID_MODE|CHAT_INBOX_PAGINATION|CHAT_INBOX_PAGE_SIZE|POSTGRES_PASSWORD|RESEND_API_KEY|EMAIL_FROM|EMAIL_REPLY_TO|SUGGESTION_NOTIFY_EMAIL|NEW_CLIENT_NOTIFY_EMAIL|PUBLIC_APP_URL|ALLOWED_ORIGINS|SWARM_ENABLED|REDIS_URL)=' .env | sed -E 's/^[[:space:]]*export[[:space:]]+//' || true)
  if [ -n "${MERCADOPAGO_ACCESS_TOKEN:-}" ]; then
    echo "==> MERCADOPAGO_ACCESS_TOKEN presente (prefixo ${MERCADOPAGO_ACCESS_TOKEN:0:14}…; len=${#MERCADOPAGO_ACCESS_TOKEN})"
    mkdir -p secrets
    printf '%s\n' "$MERCADOPAGO_ACCESS_TOKEN" > secrets/mercadopago_access_token
    chmod 600 secrets/mercadopago_access_token
    echo "==> secrets/mercadopago_access_token sincronizado a partir do .env"
    if command -v curl >/dev/null 2>&1; then
      MP_HTTP=$(curl -sS -o /tmp/zapmass-mp-verify.json -w '%{http_code}' \
        -H "Authorization: Bearer ${MERCADOPAGO_ACCESS_TOKEN}" \
        https://api.mercadopago.com/users/me 2>/dev/null || echo "000")
      if [ "$MP_HTTP" = "200" ]; then
        echo "==> Mercado Pago: token validado com sucesso (HTTP 200 /users/me)"
      else
        echo "==> ERRO CRITICO: Mercado Pago REJEITOU o token (HTTP ${MP_HTTP}). Checkout falhara com 401."
        echo "==> Regenere APP_USR- em https://www.mercadopago.com.br/developers/panel e atualize o .env"
        head -c 300 /tmp/zapmass-mp-verify.json 2>/dev/null || true
        echo
      fi
    fi
  else
    echo "==> AVISO: MERCADOPAGO_ACCESS_TOKEN vazio após .env"
  fi
  if [ "${ZAPMASS_AUTH_PROVIDER:-vps}" = "vps" ]; then
    echo "==> Auth VPS (sem Firebase)"
  elif [ -n "${FIREBASE_WEB_API_KEY:-}" ]; then
    echo "==> FIREBASE_WEB_API_KEY presente (prefixo ${FIREBASE_WEB_API_KEY:0:8}…; len=${#FIREBASE_WEB_API_KEY})"
  elif [ -n "${VITE_FIREBASE_API_KEY:-}" ]; then
    echo "==> VITE_FIREBASE_API_KEY presente p/ API (len=${#VITE_FIREBASE_API_KEY}; usar no stack deploy)"
  else
    echo "==> AVISO: modo dual/firebase sem FIREBASE_WEB_API_KEY — login funcionário legado pode falhar"
  fi
  if [ -n "${WWEBJS_WEB_VERSION_URL:-}" ]; then
    echo "==> WWEBJS_WEB_VERSION_URL exportada (${WWEBJS_WEB_VERSION_URL:0:88}…)"
  fi
  if [ -n "${VITE_GA_MEASUREMENT_ID:-}" ]; then
    echo "==> VITE_GA_MEASUREMENT_ID presente (GA4 embutido no build do frontend)"
  fi
  if [ -n "${RESEND_API_KEY:-}" ]; then
    echo "==> RESEND_API_KEY presente (prefixo ${RESEND_API_KEY:0:12}…)"
  else
    echo "==> AVISO: RESEND_API_KEY vazio — emails via Resend (confirmação de pagamento, sugestões, respostas no painel) ficam desativados no Swarm sem esta variável exportada."
  fi
  # Swarm: wa-worker deploy.replicas vem de ${WA_WORKER_REPLICAS:-0} no docker-stack (vazio = 0 réplicas).
  echo "==> ZAPMASS_API_SESSION_MODE=${ZAPMASS_API_SESSION_MODE:-monolith} WA_WORKER_REPLICAS=${WA_WORKER_REPLICAS:-0}"
  echo "==> WA_FULL_INBOX_SYNC=${WA_FULL_INBOX_SYNC:-1} (0=Pipeline só tempo real, sem puxar inbox do telefone ao conectar)"
  echo "==> WA_CHAT_ARCHIVE=${WA_CHAT_ARCHIVE:-1} (0 desliga arquivo Firestore das conversas no servidor)"
  if [ "${ZAPMASS_API_SESSION_MODE:-monolith}" != "api" ] && [ "${WA_WORKER_REPLICAS:-0}" = "0" ]; then
    echo "==> AVISO: worker com 0 réplicas. Para API separada do Chromium (split): no .env use ZAPMASS_API_SESSION_MODE=api e WA_WORKER_REPLICAS=1 (ver .env.example)."
  fi
fi

# Libera a porta 8080 caso esteja ocupada por algum contêiner órfão ou processo zumbi (evita falha de port allocation no Swarm)
free_port_8080() {
  echo "==> Verificando se a porta 8080 está ocupada..."
  if command -v lsof >/dev/null 2>&1; then
    local pid
    pid=$(lsof -t -i :8080 || true)
    if [ -n "$pid" ]; then
      echo "==> Processo(s) encontrado(s) na porta 8080: $pid. Eliminando..."
      for p in $pid; do
        kill -9 "$p" 2>/dev/null || true
      done
      sleep 2
    fi
  elif command -v fuser >/dev/null 2>&1; then
    echo "==> Liberando porta 8080 via fuser..."
    fuser -k 8080/tcp 2>/dev/null || true
    sleep 2
  fi

  # Para e remove contêineres avulsos que possam estar tentando usar a porta 8080
  if command -v docker >/dev/null 2>&1; then
    local containers
    containers=$(docker ps -a --filter "publish=8080" -q 2>/dev/null || true)
    if [ -n "$containers" ]; then
      echo "==> Removendo contêineres avulsos na porta 8080..."
      for c in $containers; do
        if [[ ! "$(docker ps --filter id="$c" --format '{{.Names}}' 2>/dev/null || true)" =~ "zapmass_" ]]; then
          docker stop "$c" || true
          docker rm -f "$c" || true
        fi
      done
    fi
    # Adicional: garante que o contêiner 'evolution-api' avulso não está segurando a porta
    docker rm -f evolution-api 2>/dev/null || true
    docker rm -f evolution 2>/dev/null || true
  fi
}
free_port_8080

# Libera 6379 de contentores avulsos (Redis Swarm usa mode:host nesta porta).
free_port_6379() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  echo "==> Verificando porta 6379 (Redis host)..."
  local containers
  containers=$(docker ps -a --filter "publish=6379" -q 2>/dev/null || true)
  if [ -n "$containers" ]; then
    for c in $containers; do
      local name
      name="$(docker ps -a --filter id="$c" --format '{{.Names}}' 2>/dev/null || true)"
      if [[ ! "$name" =~ zapmass_ ]]; then
        echo "==> Removendo contentor avulso na 6379: ${name:-$c}"
        docker stop "$c" 2>/dev/null || true
        docker rm -f "$c" 2>/dev/null || true
      fi
    done
  fi
}

verify_redis_reachable() {
  local cid="${1:-}"
  if timeout 3 bash -c 'echo > /dev/tcp/127.0.0.1/6379' 2>/dev/null; then
    echo "OK: Redis TCP no host 127.0.0.1:6379"
    return 0
  fi
  if [ -n "${cid}" ]; then
    for _rh in host.docker.internal 172.17.0.1; do
      if docker exec "${cid}" node -e "const n=require('net');const h='${_rh}';const s=n.createConnection(6379,h,()=>{console.log('OK');process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),5000);" 2>/dev/null; then
        echo "OK: Redis via ${_rh} a partir da API"
        return 0
      fi
    done
  fi
  return 1
}

wait_swarm_service_replicas() {
  local svc=$1
  local want="${2:-1}"
  local tries="${3:-50}"
  local i running
  for i in $(seq 1 "${tries}"); do
    running="$(docker service ls --filter "name=${svc}" --format '{{.Replicas}}' 2>/dev/null | head -1 || true)"
    if [ "${running}" = "${want}/${want}" ]; then
      echo "==> ${svc} OK (${running})"
      return 0
    fi
    echo "==> aguardando ${svc} (${running:-?}, ${i}/${tries})"
    sleep 6
  done
  echo "AVISO: ${svc} nao ficou ${want}/${want} apos ${tries} tentativas." >&2
  docker service ps "${svc}" --no-trunc 2>/dev/null | head -5 || true
  return 1
}

recover_swarm_api_service() {
  echo "==> recuperacao zapmass_api (restart sem --image; evita corrida com stack deploy)"
  docker service update \
    --force \
    --update-order stop-first \
    --update-parallelism 1 \
    --update-delay 10s \
    zapmass_api 2>/dev/null || true
  wait_swarm_service_replicas zapmass_api 1 40 || return 1
}

wait_redis_host() {
  local tries="${1:-20}"
  local i
  for i in $(seq 1 "${tries}"); do
    if timeout 2 bash -c 'echo > /dev/tcp/127.0.0.1/6379' 2>/dev/null; then
      echo "==> Redis host pronto (tentativa ${i})"
      return 0
    fi
    echo "==> aguardando Redis host :6379 (${i}/${tries})"
    sleep 3
  done
  return 1
}

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

# Lê SWARM_ENABLED diretamente do .env para garantir que o valor do arquivo prevaleça,
# mesmo que o loop de export acima não o tenha capturado (por ex. formato "export VAR=0").
_sw_from_env="$(grep -E '^[[:space:]]*(export[[:space:]]+)?SWARM_ENABLED=' .env 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?SWARM_ENABLED=//' | tr -d '[:space:]\"'"'"'' || true)"
if [ -n "${_sw_from_env}" ]; then
  SWARM_ENABLED="${_sw_from_env}"
  echo "==> SWARM_ENABLED=${SWARM_ENABLED} (lido do .env)"
fi
unset _sw_from_env
SWARM_ENABLED="${SWARM_ENABLED:-auto}"
IS_SWARM_MANAGER="0"
if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
  IS_SWARM_MANAGER="1"
fi

if [ "$SWARM_ENABLED" = "1" ] || { [ "$SWARM_ENABLED" = "auto" ] && [ "$IS_SWARM_MANAGER" = "1" ]; }; then
  echo "==> deploy em Docker Swarm (stack: zapmass)"
  # Testar overlay Swarm: se Redis VIP inacessível, migrar para Compose (bridge DNS funciona).
  echo "==> testando overlay Swarm (Redis VIP)..."
  _overlay_ok=0
  _overlay_net="zapmass_zapmass_internal"
  if docker network inspect "${_overlay_net}" >/dev/null 2>&1; then
    if docker run --rm --network "${_overlay_net}" redis:7-alpine \
         sh -c 'redis-cli -h redis -p 6379 ping 2>/dev/null | grep -q PONG' 2>/dev/null; then
      _overlay_ok=1
      echo "==> overlay OK (redis:6379 acessivel)"
    fi
  fi
  if [ "${_overlay_ok}" = "0" ]; then
    echo "==> overlay Swarm quebrado (Redis VIP inacessível) — migrando para Docker Compose"
    echo "==> Docker Compose usa bridge network onde redis:6379 resolve corretamente"
    chmod +x deployment/migrar-swarm-para-compose.sh
    exec bash deployment/migrar-swarm-para-compose.sh
  fi
  unset _overlay_ok _overlay_net
  # Overlay nó único: redis/tasks.redis → EHOSTUNREACH. Redis publicado no host :6379.
  export REDIS_URL=redis://host.docker.internal:6379
  echo "==> REDIS_URL=${REDIS_URL}"
  if [ -f .env ] && grep -qE '^REDIS_URL=' .env 2>/dev/null; then
    if ! grep -q 'host.docker.internal' .env 2>/dev/null; then
      echo "==> corrigindo REDIS_URL no .env (env_file nao pode apontar para overlay redis:6379)"
      sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://host.docker.internal:6379|' .env
    fi
  fi
  free_port_6379
  _build_extra=()
  if [ "${ZAPMASS_DOCKER_BUILD_NO_CACHE:-0}" = "1" ]; then
    _build_extra+=(--no-cache)
    echo "==> ZAPMASS_DOCKER_BUILD_NO_CACHE=1 — build completo sem cache de camadas"
  fi
  if [ "${ZAPMASS_SKIP_DOCKER_BUILD:-0}" = "1" ]; then
    if docker image inspect zapmass:latest >/dev/null 2>&1; then
      echo "==> ZAPMASS_SKIP_DOCKER_BUILD=1 — reutiliza imagem zapmass:latest (sem rebuild)"
    else
      echo "ERRO: ZAPMASS_SKIP_DOCKER_BUILD=1 mas zapmass:latest não existe."
      exit 1
    fi
  else
  _build_ok=0
  for _build_try in 1 2 3; do
    echo "==> docker build (tentativa ${_build_try}/3)"
    if docker build "${_build_extra[@]}" -t zapmass:latest \
      --build-arg CACHEBUST="${VITE_GIT_REF}" \
      --build-arg VITE_ADMIN_EMAILS="${VITE_ADMIN_EMAILS:-}" \
      --build-arg VITE_ZAPMASS_ADMIN_UIDS="${VITE_ZAPMASS_ADMIN_UIDS:-}" \
      --build-arg VITE_MARKETING_PRICE_MONTHLY="${VITE_MARKETING_PRICE_MONTHLY:-}" \
      --build-arg VITE_MARKETING_PRICE_ANNUAL="${VITE_MARKETING_PRICE_ANNUAL:-}" \
      --build-arg VITE_ENFORCE_SUBSCRIPTION="${VITE_ENFORCE_SUBSCRIPTION:-true}" \
      --build-arg VITE_CREATOR_STUDIO="${VITE_CREATOR_STUDIO:-}" \
      --build-arg VITE_GIT_REF="${VITE_GIT_REF}" \
      --build-arg VITE_GA_MEASUREMENT_ID="${VITE_GA_MEASUREMENT_ID:-}" \
      --build-arg VITE_USE_VPS_AUTH="${VITE_USE_VPS_AUTH:-}" \
      --build-arg VITE_USE_VPS_DATA="${VITE_USE_VPS_DATA:-}" \
      .; then
      _build_ok=1
      break
    fi
    echo "==> AVISO: docker build falhou; aguardando 45s antes de nova tentativa (OOM/rede?)"
    sleep 45
  done
  if [ "${_build_ok}" != "1" ]; then
    echo "ERRO: docker build falhou após 3 tentativas."
    echo "==> dica: VPS com pouca RAM — BUILDKIT_MAX_PARALLELISM=1 no .env; ou SOS_SKIP_BUILD=1 em recover manual"
    docker service ps zapmass_api --no-trunc 2>/dev/null | head -5 || true
    exit 1
  fi
  unset _build_ok _build_try
  fi

  _stack_ok=0
  for _stack_try in 1 2 3 4 5; do
    echo "==> docker stack deploy (tentativa ${_stack_try}/5)"
    if docker stack deploy -c docker-stack.yml zapmass --with-registry-auth; then
      _stack_ok=1
      break
    fi
    echo "==> AVISO: stack deploy falhou (ex.: update out of sequence); aguardando 20s…"
    sleep 20
  done
  if [ "${_stack_ok}" != "1" ]; then
    echo "ERRO: docker stack deploy falhou após 5 tentativas."
    exit 1
  fi
  unset _stack_ok _stack_try
  docker tag zapmass:latest zapmass-zapmass:latest 2>/dev/null || true
  # Swarm: duas "service update" em sequência podem falhar com "update out of sequence" — retentar e espaçar.
  swarm_update_retry() {
    local svc=$1
    local img="${2:-}"
    local a
    for a in 1 2 3 4 5 6; do
      if [ -n "${img}" ]; then
        if docker service update --force --image "${img}" "$svc" 2>/dev/null; then
          echo "==> (swarm) $svc actualizado (tentativa $a)."
          return 0
        fi
      elif docker service update --force "$svc" 2>/dev/null; then
        echo "==> (swarm) $svc actualizado (tentativa $a)."
        return 0
      fi
      echo "==> (swarm) $svc falhou (tentativa $a/6; ex.: conflito de versao). Aguardar 12s…"
      sleep 12
    done
    echo "==> AVISO: $svc nao actualizado apos 6 tentativas." >&2
    return 1
  }
  if docker service inspect zapmass_redis >/dev/null 2>&1; then
    echo "==> (swarm) forçar recriação: zapmass_redis (porta host 6379)"
    swarm_update_retry zapmass_redis || echo "AVISO: zapmass_redis force-update falhou; stack deploy pode ter aplicado."
    wait_redis_host 25 || echo "AVISO: Redis host :6379 ainda não responde — healthcheck continuará."
  fi
  echo "==> aguardando stack deploy convergir (zapmass_api) — sem force --image (evita 0/1)"
  _api_wait=45
  if [ -n "${GITHUB_ACTIONS:-}" ]; then _api_wait=70; fi
  if ! wait_swarm_service_replicas zapmass_api 1 "${_api_wait}"; then
    recover_swarm_api_service || echo "AVISO: recuperacao da API falhou; ver docker service ps zapmass_api"
  fi
  # wa-worker: só escala se replicas > 0 (force --image quebrava corrida com stack deploy na API).
  if docker service inspect zapmass_wa-worker >/dev/null 2>&1; then
    _wr="${WA_WORKER_REPLICAS:-0}"
    case "${_wr}" in ''|*[!0-9]*) _wr=0 ;; esac
    if [ "${_wr}" -gt 0 ]; then
      echo "==> (swarm) zapmass_wa-worker → ${_wr} réplicas (WA_WORKER_REPLICAS no .env)"
      docker service scale "zapmass_wa-worker=${_wr}" || true
    fi
    unset _wr
  fi
  # Só alterar ficheiros em deployment/swarm/*.yml no host não recria a tarefa: força reload das regras do Prometheus.
  if docker service inspect zapmass_prometheus >/dev/null 2>&1; then
    echo "==> (swarm) forçar recarregamento: zapmass_prometheus (alert_rules.yml / prometheus.yml no host)"
    docker service update --force zapmass_prometheus >/dev/null 2>&1 || true
  fi
else
  echo "==> docker compose build + up"
  if [ "${ZAPMASS_DOCKER_BUILD_NO_CACHE:-0}" = "1" ]; then
    echo "==> ZAPMASS_DOCKER_BUILD_NO_CACHE=1 — compose build --no-cache"
    docker compose build --no-cache
    docker compose up -d
  else
    docker compose up -d --build
  fi
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
  # shellcheck source=deployment/clientes/scripts/_comum.sh
  . "$(dirname "$0")/clientes/scripts/_comum.sh"
  for dir in /opt/zapmass/clientes/*/; do
    slug="$(basename "$dir")"
    case "$slug" in
      *removido*) continue ;;
    esac
    [ -f "${dir}docker-compose.yml" ] || continue
    echo "    - cliente: ${slug}"
    if ! recriar_cliente_compose "$dir" "$slug"; then
      echo "AVISO: falha ao atualizar cliente ${slug} (deploy principal continua)" >&2
    fi
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

# GitHub Actions: build/stack num passo; health longo em deployment/gha-healthcheck.sh
if [ "${ZAPMASS_DEPLOY_SKIP_HEALTHCHECK:-0}" = "1" ]; then
  echo "==> ZAPMASS_DEPLOY_SKIP_HEALTHCHECK=1 — build/stack OK; health no passo GHA seguinte"
  if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
    _api_wait=70
    wait_swarm_service_replicas zapmass_api 1 "${_api_wait}" || recover_swarm_api_service || true
  fi
  echo "==> deploy concluido (sem health inline). Commit: ${VITE_GIT_REF:-?}"
  exit 0
fi

# Healthcheck: Swarm rolling + start-period 180s no Dockerfile — no GHA dar mais margem.
HP="${HOST_PORT:-3001}"
_HEALTH_TRIES="${DEPLOY_HEALTH_TRIES:-60}"
if [ -n "${GITHUB_ACTIONS:-}" ] && [ "${_HEALTH_TRIES}" -lt 120 ]; then
  _HEALTH_TRIES=120
fi
if [ -n "${GITHUB_ACTIONS:-}" ] || [ "${GITHUB_EVENT_NAME:-}" = "push" ] || [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ]; then
  _wait="${DEPLOY_HEALTH_INITIAL_WAIT:-90}"
  echo "==> pausa ${_wait}s antes do healthcheck (deploy via GitHub Actions / container a subir)"
  sleep "${_wait}"
fi

_health_poll() {
  local tries="$1"
  local i code
  for i in $(seq 1 "${tries}"); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HP}/api/health" || echo 000)
    echo "tentativa $i: HTTP $code"
    if [ "$code" = "200" ]; then
      return 0
    fi
    sleep 6
  done
  return 1
}

echo "==> aguardando API /api/health (porta publicada: ${HP}, até $((_HEALTH_TRIES * 6))s)"
for i in $(seq 1 "${_HEALTH_TRIES}"); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HP}/api/health" || echo 000)
  echo "tentativa $i: HTTP $code"
  if [ "$code" = "200" ]; then
    _DEPLOY_REF="${VITE_GIT_REF:-unknown}"
    _LIVE_VER="$(curl -sf "http://127.0.0.1:${HP}/api/version" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
    echo "==> versão em execução: ${_LIVE_VER:-?} (esperado: ${_DEPLOY_REF})"
    if [ -n "${_LIVE_VER}" ] && [ "${_LIVE_VER}" != "${_DEPLOY_REF}" ] && [ "${_DEPLOY_REF}" != "unknown" ]; then
      echo "AVISO: versão da API difere do commit deployado — container pode estar desatualizado."
      echo "       Tente: docker service update --force --image zapmass:latest zapmass_api"
    fi
    _CID="$(docker ps -q --filter name=zapmass_api | head -1)"
    if [ -n "${_CID}" ]; then
      echo "==> teste Redis (host + container API)"
      if verify_redis_reachable "${_CID}"; then
        echo "OK: Redis acessível."
      else
        echo "AVISO: Redis não verificado neste deploy — API respondeu 200."
        echo "       Na VPS: docker service ps zapmass_redis && ss -tlnp | grep 6379"
      fi
    fi
    echo "OK: API saudável."
    exit 0
  fi
  sleep 6
done
echo "FALHA: API não respondeu 200 após $((_HEALTH_TRIES * 6))s — tentativa de recuperação rápida"
if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
  recover_swarm_api_service || true
  sleep 60
  if _health_poll 45; then
    echo "OK: API saudável após recover_swarm_api_service."
    exit 0
  fi
fi
echo "FALHA: API ainda indisponível após recuperação"
export GHA_SHA="${GHA_SHA:-$(git rev-parse HEAD 2>/dev/null || echo '')}"
if docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null | grep -qE '^active true$'; then
  echo "==> docker service ps + logs (swarm)"
  docker service ps zapmass_api || true
  docker service logs --since 10m --tail 200 zapmass_api || true
  if [ -f deployment/recover-api-swarm.sh ]; then
    chmod +x deployment/SOS-API-FORA.sh deployment/recover-api-swarm.sh 2>/dev/null || true
    echo "==> tentativa automatica: recover-api-swarm.sh (commit ${GHA_SHA:-HEAD})"
    if bash deployment/recover-api-swarm.sh; then
      echo "OK: API recuperada apos recover-api-swarm.sh"
      exit 0
    fi
    if [ -f deployment/SOS-API-FORA.sh ]; then
      echo "==> tentativa automatica: SOS-API-FORA.sh"
      if bash deployment/SOS-API-FORA.sh; then
        echo "OK: API recuperada apos SOS-API-FORA.sh"
        exit 0
      fi
    fi
  fi
else
  docker compose -f /opt/zapmass/docker-compose.yml ps || true
  docker compose -f /opt/zapmass/docker-compose.yml logs --tail=120 || true
fi
exit 1
