#!/usr/bin/env bash
# Instala cron do monitor de HealthScore (chip-health summary → Discord/Telegram).
#
# Pré-requisito: /opt/zapmass/data/chip-health-monitor.env com token + webhook.
#
# Uso:
#   sudo bash deployment/install-chip-health-monitor-cron.sh

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
MONITOR="${ROOT}/deployment/monitor-zapmass.sh"
MARKER="/etc/cron.d/zapmass-chip-health"
CRON_SCHEDULE="${ZAPMASS_CHIP_HEALTH_CRON:-*/10 * * * *}"
ENV_FILE="${ZAPMASS_MONITOR_ENV:-${ROOT}/data/chip-health-monitor.env}"

if [ ! -f "${MONITOR}" ]; then
  echo "ERRO: ${MONITOR} não encontrado. Faça git pull em ${ROOT}."
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "AVISO: precisa de root. Execute: sudo bash $0"
  exit 1
fi

chmod +x "${MONITOR}"

touch /var/log/zapmass-chip-health.log /var/log/zapmass-chip-health-state.txt
chmod 644 /var/log/zapmass-chip-health.log /var/log/zapmass-chip-health-state.txt 2>/dev/null || true

if [ ! -f "${ENV_FILE}" ]; then
  echo "AVISO: ${ENV_FILE} não existe."
  echo "  cp ${ROOT}/deployment/chip-health-monitor.env.example ${ENV_FILE}"
  echo "  chmod 600 ${ENV_FILE} && nano ${ENV_FILE}"
fi

CRON_LINE="${CRON_SCHEDULE} root cd ${ROOT} && ZAPMASS_ROOT=${ROOT} ZAPMASS_MONITOR_ENV=${ENV_FILE} bash ${MONITOR} >> /var/log/zapmass-chip-health.log 2>&1"

cat >"${MARKER}" <<EOF
# ZapMass — monitor HealthScore (anti-ban v2.3.128+)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF

chmod 644 "${MARKER}"

# Atalho opcional na raiz (como sugerido na doc)
ln -sf "${MONITOR}" "${ROOT}/monitor-zapmass.sh" 2>/dev/null || true

echo "OK: cron instalado em ${MARKER}"
echo "    Schedule: ${CRON_SCHEDULE}"
echo "    Script:   ${MONITOR}"
echo "    Log:      /var/log/zapmass-chip-health.log"
echo ""
echo "Teste manual:"
echo "  sudo ZAPMASS_MONITOR_ENV=${ENV_FILE} bash ${MONITOR}"
