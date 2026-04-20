#!/usr/bin/env bash
# Remove serviço systemd e (opcionalmente) a pasta do app — instalação do zero.
# Uso: sudo bash deployment/reset-vps.sh
#       sudo bash deployment/reset-vps.sh --apagar-projeto /opt/zapmass-sender

set -euo pipefail

if [ "${EUID:-0}" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

echo "==> Parando e removendo o serviço zapmass..."
systemctl stop zapmass 2>/dev/null || true
systemctl disable zapmass 2>/dev/null || true
rm -f /etc/systemd/system/zapmass.service
systemctl daemon-reload
echo "    OK (unit removida)."

if [ "${1:-}" = "--apagar-projeto" ] && [ -n "${2:-}" ]; then
  TARGET="$2"
  if [ ! -d "$TARGET" ]; then
    echo "Pasta não existe: $TARGET"
    exit 1
  fi
  echo "!!! Vai apagar TUDO em: $TARGET"
  echo "    (código, node_modules, dist, dados WhatsApp em data/, sessões, etc.)"
  read -r -p "Digite APAGAR para confirmar: " conf
  if [ "$conf" != "APAGAR" ]; then
    echo "Cancelado."
    exit 1
  fi
  rm -rf "$TARGET"
  echo "Pasta removida."
else
  echo ""
  echo "Próximo passo (faça manualmente se quiser pasta limpa):"
  echo "  sudo bash deployment/reset-vps.sh --apagar-projeto /opt/zapmass-sender"
  echo ""
  echo "Ou apague só o clone e envie o projeto de novo pelo WinSCP/rsync."
fi
