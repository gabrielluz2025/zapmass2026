#!/usr/bin/env bash
# Cron diário de backup para todos os clientes Plano B (03:15 UTC).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

CRON_LINE="15 3 * * * root ${SELF_DIR}/backup-todos-clientes.sh >> /var/log/zapmass-backup.log 2>&1"
CRON_FILE="/etc/cron.d/zapmass-clientes-backup"

if [ -f "$CRON_FILE" ] && grep -qF "backup-todos-clientes.sh" "$CRON_FILE" 2>/dev/null; then
    ok "Cron de backup já instalado."
    exit 0
fi

cat > "$CRON_FILE" <<EOF
# ZapMass Plano B — backup diário de /opt/zapmass/clientes/*/data
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF
chmod 644 "$CRON_FILE"
touch /var/log/zapmass-backup.log
chmod 640 /var/log/zapmass-backup.log
ok "Cron instalado: ${CRON_FILE} (03:15 UTC diário)"
