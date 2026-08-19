#!/usr/bin/env bash
# =============================================================================
# ZapMass — primeira instalação ou atualização na VPS (Ubuntu): clona o Git e sobe Docker.
#
# Uso:
#   sudo bash deployment/bootstrap-docker-vps.sh https://github.com/USUARIO/REPO.git
#
# Pasta padrão: /opt/zapmass (sem espaços; melhor para Docker).
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
  echo "==> Já existe clone em $TARGET — atualizando com segurança..."
  git -C "$TARGET" remote set-url origin "$REPO"
  git -C "$TARGET" fetch origin main
  git -C "$TARGET" reset --hard origin/main
  git -C "$TARGET" checkout -f main || git -C "$TARGET" checkout -B main origin/main
  git -C "$TARGET" pull --ff-only origin main || true
else
  echo "==> Clonando em $TARGET ..."
  mkdir -p "$(dirname "$TARGET")"
  git clone "$REPO" "$TARGET"
  cd "$TARGET"
  git checkout -f main || true
fi

cd "$TARGET"
exec bash deployment/instalar-docker-servidor.sh
