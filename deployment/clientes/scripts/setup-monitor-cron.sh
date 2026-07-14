#!/usr/bin/env bash
# Cron de monitoramento Plano B (health + dispatch + RAM/CPU) — a cada 15 min.
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

garantir_scripts_executaveis_clientes

CRON_LINE="*/15 * * * * root bash ${SELF_DIR}/monitor-clientes.sh >> /var/log/zapmass-monitor.log 2>&1"
CRON_FILE="/etc/cron.d/zapmass-monitor"

if [ -f "$CRON_FILE" ] && grep -qF "bash ${SELF_DIR}/monitor-clientes.sh" "$CRON_FILE" 2>/dev/null; then
    garantir_scripts_executaveis_clientes
    ok "Cron de monitoramento já instalado."
    exit 0
fi

cat > "$CRON_FILE" <<EOF
# ZapMass Plano B — health + dispatch + recursos por cliente
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF
chmod 644 "$CRON_FILE"
touch /var/log/zapmass-monitor.log
chmod 640 /var/log/zapmass-monitor.log
ok "Cron instalado: ${CRON_FILE} (a cada 15 min)"
