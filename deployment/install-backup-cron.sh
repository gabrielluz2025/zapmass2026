#!/usr/bin/env bash
# install-backup-cron.sh
# Instala o cron de backup diário do Postgres principal do ZapMass.
# Roda às 03:00 UTC (00:00 / meia-noite no fuso Brasil -03:00).
#
# USO: sudo bash /opt/zapmass/deployment/install-backup-cron.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
err()  { echo -e "${RED}✖  $*${NC}" >&2; }

if [ "$(id -u)" -ne 0 ]; then
    err "Execute como root: sudo bash $0"
    exit 1
fi

ZAPMASS_DIR="${ZAPMASS_DIR:-/opt/zapmass}"
SCRIPT="${ZAPMASS_DIR}/deployment/backup-postgres-main.sh"
CRON_FILE="/etc/cron.d/zapmass-backup-postgres"
LOG_FILE="/var/log/zapmass-backup.log"

if [ ! -f "$SCRIPT" ]; then
    err "Script de backup não encontrado: ${SCRIPT}"
    err "Certifique-se que o deploy foi feito antes de instalar o cron."
    exit 1
fi

chmod +x "$SCRIPT"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

if [ -f "$CRON_FILE" ] && grep -qF "backup-postgres-main.sh" "$CRON_FILE" 2>/dev/null; then
    ok "Cron de backup já instalado em ${CRON_FILE}."
    cat "$CRON_FILE"
    exit 0
fi

cat > "$CRON_FILE" <<EOF
# ZapMass — backup diário Postgres (03:00 UTC = meia-noite em Brasília -3h)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin:/snap/bin
ZAPMASS_DIR=${ZAPMASS_DIR}

0 3 * * * root ${SCRIPT} >> ${LOG_FILE} 2>&1
EOF

chmod 644 "$CRON_FILE"
ok "Cron instalado: ${CRON_FILE}"
ok "Horário: 03:00 UTC (00:00 horário de Brasília)"
ok "Log: ${LOG_FILE}"
echo ""
echo "Para testar agora: sudo bash ${SCRIPT}"
echo "Para ver o log:    tail -f ${LOG_FILE}"
