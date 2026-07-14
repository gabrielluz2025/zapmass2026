#!/usr/bin/env bash
# Cron para processar fila de provisionamento pós-pagamento (a cada 5 min).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

garantir_scripts_executaveis_clientes

CRON_LINE="*/5 * * * * root bash ${SELF_DIR}/processar-fila-provision.sh >> /var/log/zapmass-provision.log 2>&1"
CRON_FILE="/etc/cron.d/zapmass-provision"

if [ -f "$CRON_FILE" ] && grep -qF "bash ${SELF_DIR}/processar-fila-provision.sh" "$CRON_FILE" 2>/dev/null; then
    garantir_scripts_executaveis_clientes
    ok "Cron de provisionamento já instalado."
    exit 0
fi

mkdir -p /opt/zapmass/provision-queue/pending /opt/zapmass/provision-queue/done /opt/zapmass/provision-queue/failed
chmod 750 /opt/zapmass/provision-queue

cat > "$CRON_FILE" <<EOF
# ZapMass — fila pós-pagamento Mercado Pago → novo cliente Plano B
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_LINE}
EOF
chmod 644 "$CRON_FILE"
touch /var/log/zapmass-provision.log
chmod 640 /var/log/zapmass-provision.log
ok "Cron instalado: ${CRON_FILE} (a cada 5 min)"
