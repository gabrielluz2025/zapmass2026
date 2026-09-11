#!/usr/bin/env bash
# Bootstrap do monitor chip-health na VPS (v2.3.130+).
# Resolve: git pull pendente + pasta data/ ausente + chave interna não configurada.
#
# Uso (na VPS):
#   cd /opt/zapmass && sudo bash deployment/setup-chip-health-monitor.sh
#
# Variáveis:
#   ZAPMASS_ROOT=/opt/zapmass
#   SKIP_GIT_PULL=1        — não roda git pull
#   SKIP_DOCKER=1          — não reinicia containers
#   SKIP_CRON=1            — não instala cron
#   SKIP_MONITOR_TEST=1    — não executa monitor-zapmass.sh ao final

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
ENV_FILE="${ROOT}/data/chip-health-monitor.env"
EXAMPLE="${ROOT}/deployment/chip-health-monitor.env.example"
MONITOR="${ROOT}/deployment/monitor-zapmass.sh"
MAIN_ENV="${ROOT}/.env"

cd "${ROOT}"

echo "==> ZapMass — setup monitor chip-health"
echo "    Raiz: ${ROOT}"

if [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
  echo "==> git pull origin main"
  git pull origin main
fi

if [ ! -f "${MONITOR}" ]; then
  echo "ERRO: ${MONITOR} não encontrado. Rode git pull origin main (precisa v2.3.130+)."
  exit 1
fi

mkdir -p "${ROOT}/data"

if [ ! -f "${ENV_FILE}" ]; then
  if [ ! -f "${EXAMPLE}" ]; then
    echo "ERRO: ${EXAMPLE} não encontrado."
    exit 1
  fi
  cp "${EXAMPLE}" "${ENV_FILE}"
  echo "==> Criado ${ENV_FILE} a partir do example"
fi
chmod 600 "${ENV_FILE}"

upsert_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  touch "${file}"
  if grep -qE "^[[:space:]]*${key}=" "${file}" 2>/dev/null; then
    sed -i "s|^[[:space:]]*${key}=.*|${key}=${value}|" "${file}"
  else
    echo "${key}=${value}" >>"${file}"
  fi
}

if grep -qE '^[[:space:]]*ZAPMASS_INTERNAL_MONITOR_KEY=.+' "${MAIN_ENV}" 2>/dev/null; then
  EXISTING_KEY="$(grep -E '^[[:space:]]*ZAPMASS_INTERNAL_MONITOR_KEY=' "${MAIN_ENV}" | tail -1 | cut -d= -f2- | tr -d '\r')"
  echo "==> ZAPMASS_INTERNAL_MONITOR_KEY já existe no .env — reutilizando"
  upsert_env_key "${ENV_FILE}" "ZAPMASS_INTERNAL_MONITOR_KEY" "${EXISTING_KEY}"
else
  MONITOR_KEY="$(openssl rand -hex 32)"
  upsert_env_key "${MAIN_ENV}" "ZAPMASS_INTERNAL_MONITOR_KEY" "${MONITOR_KEY}"
  upsert_env_key "${ENV_FILE}" "ZAPMASS_INTERNAL_MONITOR_KEY" "${MONITOR_KEY}"
  echo "==> Chave interna gerada e gravada em .env + chip-health-monitor.env"
fi

if [ "${SKIP_DOCKER:-0}" != "1" ]; then
  echo "==> docker compose up -d --build"
  docker compose up -d --build
  echo "==> Aguardando API (15s)..."
  sleep 15
fi

VER="$(curl -sf "http://127.0.0.1:${ZAPMASS_HOST_PORT:-3001}/api/version" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || echo '?')"
echo "==> Versão API: ${VER}"

if [ "${SKIP_CRON:-0}" != "1" ]; then
  bash "${ROOT}/deployment/install-chip-health-monitor-cron.sh"
fi

if [ "${SKIP_MONITOR_TEST:-0}" != "1" ]; then
  echo "==> Teste monitor-zapmass.sh"
  ZAPMASS_ROOT="${ROOT}" ZAPMASS_MONITOR_ENV="${ENV_FILE}" bash "${MONITOR}"
fi

echo ""
echo "OK: monitor chip-health pronto."
echo "  Log: tail -f /var/log/zapmass-chip-health.log"
echo "  Baseline: curl -s -H \"X-Internal-Secret: \$(grep ZAPMASS_INTERNAL_MONITOR_KEY ${ENV_FILE} | cut -d= -f2)\" http://127.0.0.1:${ZAPMASS_HOST_PORT:-3001}/api/chip-health/summary | jq ."
