#!/usr/bin/env bash
# Estabilização completa da VPS ZapMass (idempotente).
# Auditoria + arquitetura + demo parado + Postgres + índice Evolution + .env + prune + health.
#
# Uso (um comando):
#   cd /opt/zapmass && sudo bash deployment/vps-stabilize-producao.sh
#
# Variáveis opcionais:
#   ZAPMASS_ROOT=/opt/zapmass
#   DEPLOY_SKIP_CLIENTS=demo,staging   (default: demo)
#   SKIP_BUILDER_PRUNE=1               (não limpar cache de build)
#   SKIP_RECREATE_ZAPMASS=1            (não recriar container principal após .env)

set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
ENV_FILE="${ZAPMASS_ROOT}/.env"
CLIENTES_DIR="${ZAPMASS_ROOT}/clientes"
DEPLOY_SKIP_CLIENTS="${DEPLOY_SKIP_CLIENTS:-demo,staging}"
HOST_PORT="${HOST_PORT:-3001}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; BLD=$'\033[1m'; END=$'\033[0m'

log()  { echo "${CYN}[stabilize]${END} $*"; }
ok()   { echo "${GRN}[ok]${END} $*"; }
warn() { echo "${YEL}[aviso]${END} $*" >&2; }
err()  { echo "${RED}[erro]${END} $*" >&2; }

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "Execute como root: sudo bash $0"
    exit 1
  fi
}

slug_in_skip_list() {
  local slug="$1"
  local IFS=,
  local s
  for s in $DEPLOY_SKIP_CLIENTS; do
    s="$(echo "$s" | tr -d '[:space:]')"
    [ -n "$s" ] && [ "$slug" = "$s" ] && return 0
  done
  return 1
}

detect_nginx_upstream_port() {
  local f port=""
  for f in /etc/nginx/sites-enabled/* /etc/nginx/sites-available/*; do
    [ -f "$f" ] || continue
    port="$(grep -hoE 'proxy_pass[[:space:]]+http://127\.0\.0\.1:[0-9]+' "$f" 2>/dev/null \
      | head -1 | grep -oE '[0-9]+$' || true)"
    [ -n "$port" ] && break
  done
  printf '%s' "${port:-3001}"
}

health_code() {
  local port="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${port}/api/health" 2>/dev/null || echo 000
}

set_env_kv() {
  local key="$1" val="$2" file="$3"
  [ -f "$file" ] || touch "$file"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null; then
    sed -i "s|^[[:space:]]*\(export[[:space:]]\+\)\?${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

find_postgres_container() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres' | grep -E 'zapmass|evolution' | head -1 || true
}

# ─── Início ───────────────────────────────────────────────────────────────────
need_root

echo ""
echo "${BLD}════════════════════════════════════════════════════════════${END}"
echo "${BLD}  ZapMass — estabilização completa de produção (VPS)${END}"
echo "${BLD}════════════════════════════════════════════════════════════${END}"
echo ""

if [ ! -d "$ZAPMASS_ROOT" ]; then
  err "Raiz ${ZAPMASS_ROOT} não encontrada."
  exit 1
fi

cd "$ZAPMASS_ROOT"

# ─── 1. Auditoria ────────────────────────────────────────────────────────────
log "1/9 Auditoria inicial"
echo "  Data:     $(date -Iseconds)"
echo "  Host:     $(hostname -f 2>/dev/null || hostname)"
echo "  Uptime:   $(uptime -p 2>/dev/null || uptime)"
echo "  Disco /:  $(df -h / | awk 'NR==2{print $3" usado, "$4" livre ("$5")"}')"
echo "  CPUs:     $(nproc 2>/dev/null || echo ?)"

NGINX_PORT="$(detect_nginx_upstream_port)"
echo "  Nginx →:  127.0.0.1:${NGINX_PORT} (detectado em sites nginx)"

H3001="$(health_code 3001)"
H3100="$(health_code 3100)"
echo "  Health :3001 → HTTP ${H3001}"
echo "  Health :3100 → HTTP ${H3100}"

if [ "$NGINX_PORT" = "3001" ] && [ "$H3001" != "200" ]; then
  warn "Nginx aponta para 3001 mas health não responde 200 — verifique docker compose."
elif [ "$NGINX_PORT" = "3100" ] && [ "$H3100" != "200" ]; then
  warn "Nginx aponta para 3100 (Plano B) — confirme se demo/cliente é produção intencional."
fi

echo ""
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | head -20 || true
echo ""
docker stats --no-stream 2>/dev/null | head -10 || true
echo ""

# ─── 2. Isolar demo/staging do deploy automático ────────────────────────────
log "2/9 Clientes não-produção (skip deploy + parar containers)"
IFS=',' read -r -a _skip_arr <<< "$DEPLOY_SKIP_CLIENTS"
for raw in "${_skip_arr[@]}"; do
  slug="$(echo "$raw" | tr -d '[:space:]')"
  [ -z "$slug" ] && continue
  dir="${CLIENTES_DIR}/${slug}"
  if [ ! -d "$dir" ]; then
    log "  slug '${slug}': pasta não existe — ignorado"
    continue
  fi
  touch "${dir}/.deploy-skip"
  ok "  ${slug}: .deploy-skip criado (deploy não recria este cliente)"
  cname="zapmass-cli-${slug}"
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$cname"; then
    docker stop "$cname" 2>/dev/null || true
    docker update --restart=no "$cname" 2>/dev/null || true
    ok "  ${slug}: container parado, restart=no"
  fi
done
unset _skip_arr raw slug dir cname

# Clientes pagos: manter; só garantir .deploy-skip ausente nos que devem subir no deploy
if [ -d "$CLIENTES_DIR" ]; then
  for dir in "${CLIENTES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    if slug_in_skip_list "$slug"; then
      continue
    fi
    rm -f "${dir}/.deploy-skip"
    log "  cliente ativo (deploy): ${slug}"
  done
fi

# ─── 3. .env produção ───────────────────────────────────────────────────────
log "3/9 Ajustes idempotentes em ${ENV_FILE}"
if [ ! -f "$ENV_FILE" ]; then
  warn ".env não existe — copie de .env.example antes de continuar."
else
  set_env_kv "EVOLUTION_WEBHOOK_WORKER_CONCURRENCY" "4" "$ENV_FILE"
  set_env_kv "CAMPAIGN_WORKER_CONCURRENCY" "5" "$ENV_FILE"
  set_env_kv "PRUNE_AFTER_DEPLOY" "1" "$ENV_FILE"
  set_env_kv "PRUNE_BUILDER_AFTER_DEPLOY" "1" "$ENV_FILE"
  # Inbox: 1 = findChats + prefetch histórico (recomendado para bate-papo completo)
  if ! grep -qE '^[[:space:]]*WA_FULL_INBOX_SYNC=' "$ENV_FILE" 2>/dev/null; then
    set_env_kv "WA_FULL_INBOX_SYNC" "1" "$ENV_FILE"
  fi
  if ! grep -qE '^[[:space:]]*HOST_PORT=' "$ENV_FILE" 2>/dev/null; then
    set_env_kv "HOST_PORT" "${HOST_PORT}" "$ENV_FILE"
  fi
  ok "  EVOLUTION_WEBHOOK_WORKER_CONCURRENCY=4, CAMPAIGN_WORKER_CONCURRENCY=5"
  ok "  PRUNE_AFTER_DEPLOY=1, PRUNE_BUILDER_AFTER_DEPLOY=1"
fi

# ─── 4. Postgres tuning + índice Evolution ──────────────────────────────────
log "4/9 PostgreSQL (tuning + índice Message)"
PG_C="$(find_postgres_container)"
if [ -z "$PG_C" ]; then
  warn "Container Postgres não encontrado — pulando tuning SQL."
else
  ok "  container: ${PG_C}"
  docker exec "$PG_C" psql -U postgres -d evolution_db -v ON_ERROR_STOP=1 <<'PSQL'
ALTER SYSTEM SET max_parallel_workers_per_gather = 1;
ALTER SYSTEM SET max_parallel_workers = 2;
SELECT pg_reload_conf();
PSQL
  ok "  max_parallel_workers_per_gather=1, max_parallel_workers=2"

  # Índice: CONCURRENTLY não pode estar em bloco transacional com ON_ERROR_STOP da mesma forma
  if docker exec "$PG_C" psql -U postgres -d evolution_db -tAc \
    "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_message_instance_timestamp'" 2>/dev/null | grep -q 1; then
    ok "  índice idx_message_instance_timestamp já existe"
  else
    log "  criando índice idx_message_instance_timestamp (pode levar 1–3 min)..."
    docker exec "$PG_C" psql -U postgres -d evolution_db -c \
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_instance_timestamp ON "Message" ("instanceId", "messageTimestamp");' \
      || warn "Falha ao criar índice — verifique logs do Postgres."
    ok "  índice criado ou em progresso"
  fi
fi

# ─── 5. Prune cache de build Docker ───────────────────────────────────────────
log "5/9 Limpeza de cache de build Docker"
if [ "${SKIP_BUILDER_PRUNE:-0}" = "1" ]; then
  warn "  SKIP_BUILDER_PRUNE=1 — pulando"
else
  BEFORE="$(docker system df 2>/dev/null | awk '/Build Cache/{print $4" "$5}' | head -1 || echo '?')"
  docker builder prune -af >/dev/null 2>&1 || docker builder prune -af || true
  ok "  builder prune concluído (antes: ${BEFORE})"
  docker image prune -f >/dev/null 2>&1 || true
fi

# ─── 6. Recriar API principal (aplica .env) ─────────────────────────────────
log "6/9 Recriar serviço zapmass principal (aplica .env)"
if [ "${SKIP_RECREATE_ZAPMASS:-0}" = "1" ]; then
  warn "  SKIP_RECREATE_ZAPMASS=1 — pulando recreate"
else
  if [ -f docker-compose.yml ]; then
    docker compose up -d --no-deps --force-recreate zapmass 2>/dev/null \
      || docker compose up -d --build zapmass 2>/dev/null \
      || warn "docker compose up falhou — verifique manualmente."
    ok "  zapmass recriado"
  else
    warn "docker-compose.yml não encontrado em ${ZAPMASS_ROOT}"
  fi
fi

# ─── 7. Garantir Evolution (WhatsApp) ───────────────────────────────────────
log "7/9 Garantir Evolution (docker compose up -d evolution)"
if [ -f docker-compose.yml ]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'zapmass-evolution-1'; then
    ok "  evolution já está Up"
  else
    warn "  evolution parado ou ausente — subindo..."
    docker compose up -d evolution 2>/dev/null || docker compose up -d evolution || warn "falha ao subir evolution"
    sleep 12
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'zapmass-evolution-1'; then
      ok "  evolution Up"
    else
      warn "  evolution não ficou Up — rode: docker logs zapmass-evolution-1 --tail 50"
    fi
  fi
else
  warn "  docker-compose.yml ausente — pulando evolution"
fi

# ─── 8. Healthcheck final ───────────────────────────────────────────────────
log "8/9 Aguardando health da produção (porta ${NGINX_PORT})"
waited=0
max=120
code="000"
while [ "$waited" -lt "$max" ]; do
  code="$(health_code "$NGINX_PORT")"
  if [ "$code" = "200" ]; then
    ok "  HTTP 200 em 127.0.0.1:${NGINX_PORT} (~${waited}s)"
    curl -sS "http://127.0.0.1:${NGINX_PORT}/api/health" 2>/dev/null | head -c 400 || true
    echo ""
    break
  fi
  sleep 5
  waited=$((waited + 5))
done
if [ "$code" != "200" ]; then
  err "Health não respondeu 200 em ${max}s (HTTP ${code})."
  docker logs "$(docker ps --format '{{.Names}}' | grep -E 'zapmass-zapmass|zapmass_zapmass' | head -1)" --tail 40 2>&1 || true
  exit 1
fi

# ─── 8. Relatório ───────────────────────────────────────────────────────────
log "9/9 Relatório final"
echo ""
echo "${BLD}── Estado ──${END}"
uptime
df -h / | awk 'NR==1 || NR==2'
echo ""
docker stats --no-stream 2>/dev/null | head -8 || true
echo ""
docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null | grep -E 'zapmass|postgres|evolution|redis|cli-' || docker ps --format 'table {{.Names}}\t{{.Status}}'
echo ""
echo "${GRN}${BLD}Estabilização concluída.${END}"
echo ""
echo "Próximos deploys (git push):"
echo "  • clientes com .deploy-skip NÃO serão recriados (demo permanece parado)"
echo "  • PRUNE_BUILDER_AFTER_DEPLOY=1 no .env limpa cache após cada deploy"
echo ""
echo "Para ligar demo temporariamente (vendas/teste):"
echo "  sudo bash deployment/clientes/scripts/iniciar-cliente.sh demo"
echo "  sudo bash deployment/clientes/scripts/parar-cliente.sh demo   # quando terminar"
echo ""
echo "Monitor semanal (se instalado):"
echo "  tail -50 /var/log/zapmass-monitor-alerts.log"
echo "  sudo bash deployment/vps-monitor-producao.sh   # teste manual"
echo ""
date -Iseconds > "${ZAPMASS_ROOT}/.vps-stabilize-applied" 2>/dev/null || true
