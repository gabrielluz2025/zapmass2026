#!/usr/bin/env bash
# Blindagem completa da VPS: estabilização + monitor + cron semanal + teste imediato.
#
# Uso (após git pull):
#   cd /opt/zapmass && sudo bash deployment/vps-setup-blindagem-producao.sh

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ZapMass — blindagem de produção (estabilizar + monitor)     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: execute como root (sudo bash $0)"
  exit 1
fi

echo "==> Passo 1/3: estabilização (Postgres, demo skip, .env, Evolution, health)"
bash "${SELF_DIR}/vps-stabilize-producao.sh"

echo ""
echo "==> Passo 2/3: instalar cron semanal de monitoramento"
bash "${SELF_DIR}/install-vps-monitor-cron.sh"

echo ""
echo "==> Passo 3/3: executar monitor agora (teste)"
bash "${SELF_DIR}/vps-monitor-producao.sh"

echo ""
echo "Blindagem concluída."
echo "  • Estabilização: ${ROOT}/.vps-stabilize-applied"
echo "  • Cron: /etc/cron.d/zapmass-monitor-producao (segunda 09:00 UTC)"
echo "  • Ver alertas: tail -50 /var/log/zapmass-monitor-alerts.log"
