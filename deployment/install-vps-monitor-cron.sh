#!/usr/bin/env bash
# Instala crons de monitoramento ZapMass:
#   1) Monitor semanal (load, disco, Evolution)
#   2) Watchdog a cada 5 min (sobe o site público se cair — evita 502 prolongado)
#
# Uso: sudo bash deployment/install-vps-monitor-cron.sh

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
MONITOR="${ROOT}/deployment/vps-monitor-producao.sh"
WATCHDOG="${ROOT}/deployment/vps-watchdog-producao.sh"
MARKER="/etc/cron.d/zapmass-monitor-producao"
# min hora dia mes dow — segunda 09:00 UTC
CRON_SCHEDULE="${ZAPMASS_MONITOR_CRON:-0 9 * * 1}"
# a cada 5 minutos
WATCHDOG_SCHEDULE="${ZAPMASS_WATCHDOG_CRON:-*/5 * * * *}"

if [ ! -f "${MONITOR}" ]; then
  echo "ERRO: ${MONITOR} não encontrado. Faça git pull em ${ROOT}."
  exit 1
fi

chmod +x "${MONITOR}"
[ -f "${WATCHDOG}" ] && chmod +x "${WATCHDOG}"

CRON_LINE="${CRON_SCHEDULE} root cd ${ROOT} && ZAPMASS_ROOT=${ROOT} bash ${MONITOR} >> /var/log/zapmass-monitor.log 2>&1"
WATCHDOG_LINE="${WATCHDOG_SCHEDULE} root cd ${ROOT} && ZAPMASS_ROOT=${ROOT} bash ${WATCHDOG} >> /var/log/zapmass-watchdog.log 2>&1"

if [ "$(id -u)" -ne 0 ]; then
  echo "AVISO: precisa de root. Execute: sudo bash $0"
  exit 1
fi

touch /var/log/zapmass-monitor.log /var/log/zapmass-monitor-alerts.log /var/log/zapmass-watchdog.log
chmod 644 /var/log/zapmass-monitor.log /var/log/zapmass-monitor-alerts.log /var/log/zapmass-watchdog.log 2>/dev/null || true

cat >"${MARKER}" <<EOF
# ZapMass — monitor de produção + watchdog do site público
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF

if [ -f "${WATCHDOG}" ]; then
  cat >>"${MARKER}" <<EOF
${WATCHDOG_LINE}
EOF
fi

chmod 644 "${MARKER}"
echo "OK: cron instalado em ${MARKER}"
echo "    Monitor:   ${CRON_SCHEDULE} (UTC) → ${MONITOR}"
echo "    Watchdog:  ${WATCHDOG_SCHEDULE} → ${WATCHDOG}"
echo "    Logs: /var/log/zapmass-monitor.log , /var/log/zapmass-watchdog.log"
echo "    Alertas: /var/log/zapmass-monitor-alerts.log"
echo ""
echo "Teste manual:"
echo "  sudo bash ${MONITOR}"
echo "  sudo bash ${WATCHDOG}"
echo ""
echo "IMPORTANTE: o cliente 'demo' (porta 3100) É o site zap-mass.com."
echo "  Não use AUTO_FIX_DEMO_STOP=1 nem scripts que parem o demo."
