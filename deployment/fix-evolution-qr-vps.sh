#!/usr/bin/env bash
# Corrige Evolution + QR na VPS (Swarm + clientes demo/acme).
# Uso (root): cd /opt/zapmass && bash deployment/fix-evolution-qr-vps.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
DEFAULT_EVOLUTION_KEY="${DEFAULT_EVOLUTION_KEY:-zapmass-secure-key-2026}"
DEFAULT_POSTGRES_PASSWORD="${DEFAULT_POSTGRES_PASSWORD:-evolution-secure-pass-2026}"

log() { echo "==> $*"; }
ok() { echo "OK: $*"; }
warn() { echo "AVISO: $*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root (sudo -i)." >&2
  exit 1
fi

cd "$ROOT"
if [ ! -f "$ENV" ]; then
  echo "Erro: $ENV nao existe. Copie .env.example primeiro." >&2
  exit 1
fi

ensure_env_var() {
  local key="$1"
  local value="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV"; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$value" >> "$ENV"
  log "Adicionado ao .env: ${key}=..."
}

log "Backup do .env"
cp -a "$ENV" "${ENV}.bak.$(date +%Y%m%d%H%M%S)"

log "Garantir variaveis Evolution no .env principal"
ensure_env_var "EVOLUTION_API_KEY" "$DEFAULT_EVOLUTION_KEY"
ensure_env_var "EVOLUTION_API_URL" "http://evolution:8080"
ensure_env_var "ZAPMASS_WHATSAPP_ENGINE" "evolution"
ensure_env_var "ZAPMASS_WEBHOOK_URL" "http://api:3001/webhook/evolution"
ensure_env_var "CONFIG_SESSION_PHONE_VERSION" "2.3000.1035712111"
# So escreve POSTGRES_PASSWORD se ainda nao existir (volume pode ter senha antiga).
if ! grep -qE '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$ENV"; then
  if docker volume inspect zapmass_zapmass-postgres >/dev/null 2>&1; then
    warn "Volume postgres existe sem POSTGRES_PASSWORD no .env — use a senha original ou ZAPMASS_RESET_EVOLUTION_DB=1"
    printf '\nPOSTGRES_PASSWORD=%s\n' "$DEFAULT_POSTGRES_PASSWORD" >> "$ENV"
    log "Adicionado POSTGRES_PASSWORD padrao ao .env (se Evolution falhar auth, corrija a senha)"
  else
    ensure_env_var "POSTGRES_PASSWORD" "$DEFAULT_POSTGRES_PASSWORD"
  fi
fi

# Evolution + QR no Swarm: monolith (nao mandar QR para wa-worker wwebjs).
if grep -qE '^[[:space:]]*(export[[:space:]]+)?ZAPMASS_API_SESSION_MODE=' "$ENV"; then
  sed -i -E 's/^([[:space:]]*export[[:space:]]+)?ZAPMASS_API_SESSION_MODE=.*/ZAPMASS_API_SESSION_MODE=monolith/' "$ENV"
else
  printf '\nZAPMASS_API_SESSION_MODE=monolith\n' >> "$ENV"
fi
if grep -qE '^[[:space:]]*(export[[:space:]]+)?WA_WORKER_REPLICAS=' "$ENV"; then
  sed -i -E 's/^([[:space:]]*export[[:space:]]+)?WA_WORKER_REPLICAS=.*/WA_WORKER_REPLICAS=0/' "$ENV"
else
  printf 'WA_WORKER_REPLICAS=0\n' >> "$ENV"
fi

EVOLUTION_KEY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' "$ENV" | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"')"
EVOLUTION_KEY="${EVOLUTION_KEY:-$DEFAULT_EVOLUTION_KEY}"
POSTGRES_PASSWORD="$(grep -E '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$ENV" | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=//' | tr -d '\r"')"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$DEFAULT_POSTGRES_PASSWORD}"

swarm_network() {
  docker network ls --format '{{.Name}}' | grep -E '^zapmass(_default)?$' | head -1 || true
}

diagnose_postgres() {
  echo ""
  echo "--- zapmass_postgres (tasks) ---"
  docker service ps zapmass_postgres --no-trunc 2>&1 | head -10 || true
  echo "--- zapmass_postgres (logs) ---"
  docker service logs zapmass_postgres --tail 35 2>&1 || true
}

try_recover_postgres() {
  log "Recuperar Postgres (force update)"
  docker service update --force zapmass_postgres >/dev/null 2>&1 || true
  sleep 15
}

wait_postgres_ready() {
  log "Aguardar Postgres 1/1"
  local deadline=$((SECONDS + 240))
  local last_diag=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    local rep
    rep="$(docker service ls --filter name=zapmass_postgres --format '{{.Replicas}}' 2>/dev/null || echo '')"
    if [ "$rep" = "1/1" ]; then
      break
    fi
    echo "   postgres replicas: ${rep:-desconhecido} — aguardando..."
    if [ $((SECONDS - last_diag)) -ge 45 ]; then
      diagnose_postgres
      try_recover_postgres
      last_diag=$SECONDS
    fi
    sleep 5
  done

  rep="$(docker service ls --filter name=zapmass_postgres --format '{{.Replicas}}' 2>/dev/null || echo '')"
  if [ "$rep" != "1/1" ]; then
    warn "Postgres nao chegou a 1/1"
    diagnose_postgres
    if [ "${ZAPMASS_RESET_EVOLUTION_DB:-0}" = "1" ]; then
      log "ZAPMASS_RESET_EVOLUTION_DB=1 — executar recover-postgres-evolution.sh"
      bash "$ROOT/deployment/recover-postgres-evolution.sh"
      return $?
    fi
    warn "Execute: ZAPMASS_RESET_EVOLUTION_DB=1 bash deployment/recover-postgres-evolution.sh"
    return 1
  fi

  local net
  net="$(swarm_network)"
  if [ -z "$net" ]; then
    warn "Rede Swarm zapmass nao encontrada; a saltar pg_isready"
    return 0
  fi

  log "Testar pg_isready na rede ${net}"
  local i
  for i in $(seq 1 50); do
    if docker run --rm --network "$net" -e "PGPASSWORD=${POSTGRES_PASSWORD}" postgres:15-alpine \
      pg_isready -h postgres -U postgres -d evolution_db -q 2>/dev/null; then
      ok "Postgres aceita ligacoes (postgres:5432)"
      return 0
    fi
    sleep 4
  done

  warn "Postgres nao respondeu a pg_isready. Logs postgres:"
  docker service logs zapmass_postgres --tail 50 2>&1 || true
  return 1
}

restart_evolution_after_postgres() {
  if ! docker service inspect zapmass_evolution >/dev/null 2>&1; then
    return 0
  fi
  log "Reiniciar Evolution DEPOIS do Postgres (evita erro P1001)"
  docker service scale zapmass_evolution=0 >/dev/null 2>&1 || true
  sleep 10
  wait_postgres_ready || true
  docker service scale zapmass_evolution=1 >/dev/null 2>&1 || true
  sleep 15
}

log "Atualizar codigo e redeploy (git + vps-deploy)"
chmod +x deployment/manual-pull-deploy.sh deployment/vps-deploy.sh 2>/dev/null || true
bash deployment/ensure-git-main.sh
bash deployment/vps-deploy.sh

log "Sincronizar imagem zapmass:latest -> zapmass-zapmass:latest (clientes)"
if docker image inspect zapmass:latest >/dev/null 2>&1; then
  docker tag zapmass:latest zapmass-zapmass:latest
  ok "Imagem zapmass-zapmass:latest actualizada"
else
  warn "zapmass:latest nao encontrada; clientes podem ficar com imagem antiga"
fi

set_or_replace_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

patch_client_env() {
  local client_env="$1"
  local public_url="${2:-}"
  [ -f "$client_env" ] || return 0
  cp -a "$client_env" "${client_env}.bak.$(date +%Y%m%d%H%M%S)"
  set_or_replace_env_var "$client_env" "ZAPMASS_WHATSAPP_ENGINE" "evolution"
  set_or_replace_env_var "$client_env" "EVOLUTION_API_KEY" "$EVOLUTION_KEY"
  set_or_replace_env_var "$client_env" "EVOLUTION_API_URL" "http://172.17.0.1:8080"
  set_or_replace_env_var "$client_env" "REDIS_URL" "redis://redis:6379"
  if [ -n "$public_url" ]; then
    set_or_replace_env_var "$client_env" "ZAPMASS_WEBHOOK_URL" "${public_url%/}/webhook/evolution"
    set_or_replace_env_var "$client_env" "PUBLIC_APP_URL" "$public_url"
  fi
}

CLIENTES_DIR="$ROOT/clientes"
if [ -d "$CLIENTES_DIR" ]; then
  # shellcheck source=deployment/clientes/scripts/_comum.sh
  . "$ROOT/deployment/clientes/scripts/_comum.sh"
  for dir in "$CLIENTES_DIR"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    [ -f "${dir}/docker-compose.yml" ] || continue
    client_env="${dir}/.env"
    pub=""
    if [ -f "$client_env" ]; then
      pub="$(grep -E '^PUBLIC_URL=' "$client_env" | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
    fi
    log "Cliente ${slug}: .env Evolution + recreate"
    patch_client_env "$client_env" "$pub"
    recriar_cliente_compose "$dir" "$slug" || warn "Falha ao recriar cliente ${slug}"
  done
fi

restart_evolution_after_postgres

log "Aguardar Evolution 1/1 e HTTP 200 (ate 5 min)"
deadline=$((SECONDS + 300))
evolution_ok=0
http_code="000"
body=""
while [ "$SECONDS" -lt "$deadline" ]; do
  replicas="$(docker service ls --filter name=zapmass_evolution --format '{{.Replicas}}' 2>/dev/null || echo '')"
  http_code="$(curl -s -o /tmp/evolution-fetch.json -w '%{http_code}' \
    "http://127.0.0.1:8080/instance/fetchInstances" \
    -H "apikey: ${EVOLUTION_KEY}" 2>/dev/null || echo 000)"
  body="$(cat /tmp/evolution-fetch.json 2>/dev/null || true)"
  if [ "$replicas" = "1/1" ] && [ "$http_code" = "200" ]; then
    evolution_ok=1
    break
  fi
  echo "   evolution: ${replicas:-?} | HTTP ${http_code} — aguardando..."
  sleep 10
done

if [ "$evolution_ok" -ne 1 ]; then
  restart_evolution_after_postgres
  sleep 20
  http_code="$(curl -s -o /tmp/evolution-fetch.json -w '%{http_code}' \
    "http://127.0.0.1:8080/instance/fetchInstances" \
    -H "apikey: ${EVOLUTION_KEY}" 2>/dev/null || echo 000)"
  body="$(cat /tmp/evolution-fetch.json 2>/dev/null || true)"
  replicas="$(docker service ls --filter name=zapmass_evolution --format '{{.Replicas}}' 2>/dev/null || echo '')"
  [ "$replicas" = "1/1" ] && [ "$http_code" = "200" ] && evolution_ok=1
fi

log "Testar API ZapMass (porta ${HOST_PORT:-3001})"
api_code="$(curl -s -o /tmp/zapmass-version.json -w '%{http_code}' \
  "http://127.0.0.1:${HOST_PORT:-3001}/api/version" || echo 000)"
api_body="$(cat /tmp/zapmass-version.json 2>/dev/null || true)"

echo ""
echo "========== RESUMO =========="
docker stack services zapmass 2>/dev/null || true
docker ps --filter "name=^zapmass-cli-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
echo ""
echo "Evolution HTTP: ${http_code}"
if [ -n "$body" ]; then
  echo "Evolution body: ${body:0:200}"
else
  echo "Evolution body: (vazio — servico pode ainda estar a arrancar)"
fi
echo "API /api/version HTTP: ${api_code}"
if [ -n "$api_body" ]; then
  echo "API version: ${api_body}"
fi
echo "Chave Evolution (.env): ${EVOLUTION_KEY:0:8}..."
echo ""

if [ "$evolution_ok" -eq 1 ] && [ "$http_code" = "200" ]; then
  ok "Evolution operacional. Abra o painel e clique em Gerar QR."
  exit 0
fi

warn "Evolution ainda nao respondeu 200. Logs:"
docker service logs zapmass_postgres --tail 40 2>&1 || true
docker service logs zapmass_evolution --tail 60 2>&1 || true
echo ""
echo "Se postgres falhar por senha antiga no volume, alinhe POSTGRES_PASSWORD no .env"
echo "com a senha original OU (apaga dados Evolution) remova o volume:"
echo "  docker service scale zapmass_evolution=0"
echo "  docker volume rm zapmass_zapmass-postgres  # CUIDADO: apaga DB Evolution"
echo "  bash deployment/manual-pull-deploy.sh"
echo ""
echo "Envie ao suporte o output acima (RESUMO + logs)."
exit 1
