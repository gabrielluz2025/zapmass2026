#!/usr/bin/env bash
# Instala cron que puxa origin/main e faz deploy sem SSH do GitHub Actions.
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
SCRIPT="${ROOT}/deployment/vps-watch-deploy.sh"
MARKER="/etc/cron.d/zapmass-watch-deploy"

if [ ! -f "${SCRIPT}" ]; then
  echo "ERRO: ${SCRIPT} não encontrado. Rode a partir de /opt/zapmass."
  exit 1
fi

chmod +x "${SCRIPT}"

CRON_LINE="*/3 * * * * root cd ${ROOT} && ROOT=${ROOT} bash ${SCRIPT}"

if [ -f "${MARKER}" ] && grep -qF "${SCRIPT}" "${MARKER}" 2>/dev/null; then
  echo "OK: cron zapmass-watch-deploy já instalado (${MARKER})"
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "AVISO: precisa de root para escrever ${MARKER}"
  echo "Execute: sudo bash deployment/install-deploy-watch-cron.sh"
  exit 1
fi

cat >"${MARKER}" <<EOF
# ZapMass — deploy automático quando origin/main avança (sem SSH do GitHub Actions)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF

chmod 644 "${MARKER}"
echo "OK: cron instalado em ${MARKER} (a cada 3 minutos)"
echo "Log: /var/log/zapmass-watch-deploy.log"
