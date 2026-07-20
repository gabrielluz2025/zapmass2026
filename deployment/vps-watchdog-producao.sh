#!/usr/bin/env bash
# Watchdog leve: se o site público (Plano B) cair, sobe de novo.
# Roda a cada poucos minutos via cron — NÃO para o cliente de produção.
#
# Uso:
#   sudo bash deployment/vps-watchdog-producao.sh
# Instalar cron:
#   sudo bash deployment/install-vps-monitor-cron.sh

set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
CLIENTES_SCRIPTS="${ZAPMASS_ROOT}/deployment/clientes/scripts"
LOG_FILE="${ZAPMASS_WATCHDOG_LOG:-/var/log/zapmass-watchdog.log}"
ALERT_FILE="${ZAPMASS_MONITOR_ALERTS:-/var/log/zapmass-monitor-alerts.log}"
AUTO_FIX="${AUTO_FIX_PRODUCAO:-1}"

# shellcheck source=/dev/null
. "${CLIENTES_SCRIPTS}/_comum.sh"

log_line() {
  local msg="[$(date -Iseconds)] $*"
  echo "$msg" >>"$LOG_FILE" 2>/dev/null || true
  echo "$msg"
}

alert() {
  local msg="$1"
  echo "[$(date -Iseconds)] WATCHDOG ALERT: $msg" >>"$ALERT_FILE" 2>/dev/null || true
  log_line "ALERT: $msg"
}

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
touch "$LOG_FILE" "$ALERT_FILE" 2>/dev/null || true

read -r PROD_SLUG PROD_PORT PROD_DOM <<<"$(resolver_cliente_producao)"
PROD_SLUG="${PROD_SLUG:-demo}"
PROD_PORT="${PROD_PORT:-3100}"
PROD_DOM="${PROD_DOM:-zap-mass.com}"
CNAME="zapmass-cli-${PROD_SLUG}"
DIR="$(cliente_dir "$PROD_SLUG")"

# Nunca deixar .deploy-skip no cliente que serve o domínio público
if [ -f "${DIR}/.deploy-skip" ]; then
  rm -f "${DIR}/.deploy-skip"
  log_line "removido .deploy-skip de ${PROD_SLUG} (é produção)"
fi

# Garantir política de restart
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CNAME"; then
  docker update --restart=unless-stopped "$CNAME" >/dev/null 2>&1 || true
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PROD_PORT}/api/health" 2>/dev/null || echo 000)"
code="${code:-000}"

if [ "$code" = "200" ]; then
  log_line "OK ${PROD_SLUG} :${PROD_PORT} HTTP 200"
  exit 0
fi

alert "${PROD_SLUG} health HTTP ${code} (porta ${PROD_PORT}) — site público ${PROD_DOM}"

if [ "$AUTO_FIX" != "1" ]; then
  log_line "AUTO_FIX_PRODUCAO=0 — sem recuperação automática"
  exit 1
fi

log_line "recuperando ${CNAME}..."

# 1) start rápido se existir parado
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CNAME"; then
  docker start "$CNAME" >/dev/null 2>&1 || true
  docker update --restart=unless-stopped "$CNAME" >/dev/null 2>&1 || true
  sleep 8
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PROD_PORT}/api/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    log_line "recuperado com docker start → HTTP 200"
    exit 0
  fi
fi

# 2) compose up no diretório do cliente
if [ -f "${DIR}/docker-compose.yml" ]; then
  (cd "$DIR" && docker compose up -d --remove-orphans) >>"$LOG_FILE" 2>&1 || true
  docker update --restart=unless-stopped "$CNAME" >/dev/null 2>&1 || true
  sleep 15
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PROD_PORT}/api/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    log_line "recuperado com compose up → HTTP 200"
    exit 0
  fi
fi

# 3) fallback: corrigir-502 sem rebuild (mais rápido)
if [ -f "${CLIENTES_SCRIPTS}/corrigir-502.sh" ]; then
  log_line "fallback corrigir-502.sh --skip-build"
  ZAPMASS_SKIP_DOCKER_BUILD=1 bash "${CLIENTES_SCRIPTS}/corrigir-502.sh" "$PROD_SLUG" --skip-build >>"$LOG_FILE" 2>&1 || true
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PROD_PORT}/api/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    log_line "recuperado com corrigir-502 → HTTP 200"
    exit 0
  fi
fi

alert "FALHOU recuperar ${PROD_SLUG} (ainda HTTP ${code}). Rode: sudo bash deployment/clientes/scripts/corrigir-502.sh ${PROD_SLUG}"
exit 1
