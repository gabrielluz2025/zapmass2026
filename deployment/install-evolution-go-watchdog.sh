#!/usr/bin/env bash
# Instala cron para reiniciar automaticamente o Evolution Go se cair.
# Executa o watchdog a cada 2 minutos.
#
# Uso: sudo bash deployment/install-evolution-go-watchdog.sh
set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
WATCHDOG="$ZAPMASS_ROOT/deployment/watchdog-evolution-go.sh"
CRON_FILE="/etc/cron.d/zapmass-evolution-go-watchdog"

echo "==> Instalando watchdog do Evolution Go..."

chmod +x "$WATCHDOG" 2>/dev/null || true

# Entrada cron: a cada 2 minutos, como root
cat > "$CRON_FILE" <<EOF
# ZapMass — watchdog do Evolution Go (reinicia se cair)
*/2 * * * * root ZAPMASS_ROOT=$ZAPMASS_ROOT bash $WATCHDOG >> /var/log/zapmass-evolution-go-watchdog.log 2>&1
EOF

chmod 644 "$CRON_FILE"
echo "==> Cron instalado em $CRON_FILE (a cada 2 minutos)"

# Executa imediatamente para corrigir estado atual
echo "==> Rodando watchdog agora..."
bash "$WATCHDOG"

echo "==> Pronto. Logs em: /var/log/zapmass-evolution-go-watchdog.log"
