#!/usr/bin/env bash
# Instala cron semanal do checklist Go ↔ settings (Evolution Go drift).
#
# Uso (uma vez na VPS, ou automático após deploy):
#   sudo bash /opt/zapmass/deployment/install-go-drift-weekly-cron.sh
#
# Horário padrão: domingo 10:00 UTC (07:00 BRT).
# Personalizar: ZAPMASS_GO_DRIFT_CRON='0 8 * * 1' sudo bash ...
# Auto FIX leve se drift: ZAPMASS_GO_DRIFT_AUTO_FIX=1 sudo bash ...
#
# Log: /var/log/zapmass-go-drift-weekly.log
# Ver últimas linhas: tail -80 /var/log/zapmass-go-drift-weekly.log
set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
WRAPPER="${ROOT}/deployment/vps-weekly-go-drift-cron.sh"
CHECK="${ROOT}/deployment/vps-monthly-go-drift-check.sh"
CRON_FILE="/etc/cron.d/zapmass-go-drift-weekly"
LOG="/var/log/zapmass-go-drift-weekly.log"
# dom 10:00 UTC = 07:00 BRT
CRON_SCHEDULE="${ZAPMASS_GO_DRIFT_CRON:-0 10 * * 0}"
AUTO_FIX="${ZAPMASS_GO_DRIFT_AUTO_FIX:-0}"

if [ ! -f "${CHECK}" ]; then
  echo "ERRO: ${CHECK} não encontrado. Faça git pull em ${ROOT}."
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "AVISO: precisa de root. Execute: sudo bash $0"
  exit 1
fi

chmod +x "${WRAPPER}" "${CHECK}" 2>/dev/null || true
touch "${LOG}"
chmod 644 "${LOG}" 2>/dev/null || true

cat >"${CRON_FILE}" <<EOF
# ZapMass — checklist semanal drift Evolution Go ↔ settings
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_SCHEDULE} root cd ${ROOT} && ZAPMASS_ROOT=${ROOT} ZAPMASS_GO_DRIFT_AUTO_FIX=${AUTO_FIX} bash ${WRAPPER}
EOF

chmod 644 "${CRON_FILE}"

echo "OK: cron instalado em ${CRON_FILE}"
echo "    Agenda: ${CRON_SCHEDULE} (UTC)"
echo "    Script:  ${WRAPPER}"
echo "    Log:     ${LOG}"
echo "    AUTO_FIX leve (FIX=1 se drift): ${AUTO_FIX}"
echo ""
echo "Teste manual (sem esperar domingo):"
echo "  sudo bash ${WRAPPER}"
echo "  tail -80 ${LOG}"
