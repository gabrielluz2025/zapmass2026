#!/usr/bin/env bash
# Instala cron semanal de monitoramento da VPS ZapMass.
# Segunda-feira 09:00 UTC — ajuste CRON_SCHEDULE se quiser outro horário.
#
# Uso: sudo bash deployment/install-vps-monitor-cron.sh

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
MONITOR="${ROOT}/deployment/vps-monitor-producao.sh"
MARKER="/etc/cron.d/zapmass-monitor-producao"
# min hora dia mes dow — segunda 09:00 UTC
CRON_SCHEDULE="${ZAPMASS_MONITOR_CRON:-0 9 * * 1}"

if [ ! -f "${MONITOR}" ]; then
  echo "ERRO: ${MONITOR} não encontrado. Faça git pull em ${ROOT}."
  exit 1
fi

chmod +x "${MONITOR}"

CRON_LINE="${CRON_SCHEDULE} root cd ${ROOT} && ZAPMASS_ROOT=${ROOT} bash ${MONITOR} >> /var/log/zapmass-monitor.log 2>&1"

if [ "$(id -u)" -ne 0 ]; then
  echo "AVISO: precisa de root. Execute: sudo bash $0"
  exit 1
fi

touch /var/log/zapmass-monitor.log /var/log/zapmass-monitor-alerts.log
chmod 644 /var/log/zapmass-monitor.log /var/log/zapmass-monitor-alerts.log 2>/dev/null || true

cat >"${MARKER}" <<EOF
# ZapMass — monitor semanal de produção (load, containers, disco, auto-fix Evolution)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF

chmod 644 "${MARKER}"
echo "OK: cron instalado em ${MARKER}"
echo "    Agendamento: ${CRON_SCHEDULE} (cron padrão = UTC)"
echo "    Log: /var/log/zapmass-monitor.log"
echo "    Alertas: /var/log/zapmass-monitor-alerts.log"
echo ""
echo "Teste manual: sudo bash ${MONITOR}"
