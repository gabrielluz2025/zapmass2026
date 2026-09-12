#!/usr/bin/env bash
# Configura alertas Discord do monitor chip-health (seguro — só edita data/chip-health-monitor.env).
#
# Uso na VPS:
#   cd /opt/zapmass && sudo bash deployment/configure-chip-health-discord.sh
#
# Ou passando a URL direto (evita prompt):
#   sudo bash deployment/configure-chip-health-discord.sh 'https://discord.com/api/webhooks/...'

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
ENV_FILE="${ROOT}/data/chip-health-monitor.env"
MAIN_ENV="${ROOT}/.env"
MONITOR="${ROOT}/deployment/monitor-zapmass.sh"
WEBHOOK_URL="${1:-}"

echo "==> ZapMass — configurar alertas Discord (monitor chip-health)"
echo "    Este script NÃO altera campanhas, chips nem banco — só alertas opcionais."
echo ""

mkdir -p "${ROOT}/data"

if [ ! -f "${ENV_FILE}" ]; then
  EXAMPLE="${ROOT}/deployment/chip-health-monitor.env.example"
  if [ ! -f "${EXAMPLE}" ]; then
    echo "ERRO: rode primeiro: bash deployment/setup-chip-health-monitor.sh"
    exit 1
  fi
  cp "${EXAMPLE}" "${ENV_FILE}"
fi

BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "${ENV_FILE}" "${BACKUP}"
echo "==> Backup: ${BACKUP}"

upsert_key() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  grep -vE "^[[:space:]]*${key}=" "${ENV_FILE}" >"${tmp}" || true
  printf '%s=%s\n' "${key}" "${value}" >>"${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

remove_wrong_keys() {
  local tmp
  tmp="$(mktemp)"
  grep -vE '^[[:space:]]*(URL_DO_WEBHOOK_DO_DISCORD|ID_DO_CHAT_DO_TELEGRAM|CHIP_SAUDE_CRITICA_PLUS_LIMPEZA)=' \
    "${ENV_FILE}" >"${tmp}" || true
  mv "${tmp}" "${ENV_FILE}"
}

remove_wrong_keys

if grep -qE '^[[:space:]]*ZAPMASS_INTERNAL_MONITOR_KEY=.+' "${MAIN_ENV}" 2>/dev/null; then
  KEY="$(grep -E '^[[:space:]]*ZAPMASS_INTERNAL_MONITOR_KEY=' "${MAIN_ENV}" | tail -1 | cut -d= -f2- | tr -d '\r')"
  upsert_key "ZAPMASS_INTERNAL_MONITOR_KEY" "${KEY}"
  echo "==> Chave interna sincronizada com ${MAIN_ENV}"
fi

if [ -z "${WEBHOOK_URL}" ]; then
  echo ""
  echo "Cole a URL do webhook do Discord e pressione Enter."
  echo "(Discord → seu canal → ⚙ Editar → Integrações → Webhooks → Copiar URL)"
  echo ""
  read -r WEBHOOK_URL
fi

WEBHOOK_URL="$(echo "${WEBHOOK_URL}" | tr -d '\r' | xargs)"

if [[ ! "${WEBHOOK_URL}" =~ ^https://discord\.com/api/webhooks/[0-9]+/[^[:space:]]+$ ]]; then
  echo ""
  echo "ERRO: URL inválida. Deve começar com https://discord.com/api/webhooks/ID/TOKEN"
  echo "Nada foi alterado além do backup (restaurando arquivo anterior)."
  cp "${BACKUP}" "${ENV_FILE}"
  exit 1
fi

upsert_key "DISCORD_WEBHOOK_URL" "${WEBHOOK_URL}"
chmod 600 "${ENV_FILE}"

echo "==> DISCORD_WEBHOOK_URL configurado (nome correto para o monitor)."
echo ""

rm -f /var/log/zapmass-chip-health-state.txt 2>/dev/null || true

if [ -f "${MONITOR}" ]; then
  echo "==> Teste do monitor..."
  ZAPMASS_ROOT="${ROOT}" ZAPMASS_MONITOR_ENV="${ENV_FILE}" bash "${MONITOR}"
else
  echo "AVISO: ${MONITOR} não encontrado — configure manualmente depois do git pull."
fi

echo ""
echo "OK: se apareceu [OK] acima, confira a mensagem no canal do Discord."
