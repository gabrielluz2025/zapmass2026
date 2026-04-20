#!/usr/bin/env bash
# =============================================================================
# ZapMass — primeira instalação na VPS (Ubuntu): clona o Git e sobe Docker.
#
# Uso:
#   sudo bash deployment/bootstrap-docker-vps.sh https://github.com/USUARIO/REPO.git
#
# Pasta padrão: /opt/zapmass (sem espaços; melhor para Docker).
#
# Opcionais (mesmos de instalar-docker-servidor.sh):
#   sudo PUBLIC_IP=203.0.113.10 \
#        HOST_PORT=3001 \
#        bash deployment/bootstrap-docker-vps.sh https://github.com/USUARIO/REPO.git /opt/zapmass
#
# Com HTTPS:
#   sudo PUBLIC_URL=https://app.seudominio.com HOST_PORT=443 \
#        bash deployment/bootstrap-docker-vps.sh https://github.com/USUARIO/REPO.git
# =============================================================================
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi

if [ "${EUID:-0}" -ne 0 ]; then
  echo "Execute com sudo."
  exec sudo -E bash "$0" "$@"
fi

REPO="${1:-}"
TARGET="${2:-/opt/zapmass}"

if [ -z "$REPO" ]; then
  echo "Uso: sudo bash $0 <URL_GIT_HTTPS> [pasta_destino]"
  echo "Ex.: sudo bash $0 https://github.com/gabrielluz2025/zapmass2026.git"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git ca-certificates curl

if [ -d "$TARGET/.git" ]; then
  echo "==> Já existe clone em $TARGET — atualizando..."
  git -C "$TARGET" pull --ff-only
else
  echo "==> Clonando em $TARGET ..."
  mkdir -p "$(dirname "$TARGET")"
  git clone "$REPO" "$TARGET"
fi

cd "$TARGET"
exec bash deployment/instalar-docker-servidor.sh
