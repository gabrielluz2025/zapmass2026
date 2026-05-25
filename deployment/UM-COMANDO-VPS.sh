#!/usr/bin/env bash
# Cole UMA LINHA no terminal Hostinger (hPanel), como root:
#   curl -fsSL https://raw.githubusercontent.com/gabrielluz2025/zapmass2026/main/deployment/UM-COMANDO-VPS.sh | bash
#
# Ou, se git já estiver configurado em /opt/zapmass:
#   cd /opt/zapmass && git fetch origin main && git checkout main && git pull --ff-only origin main && bash deployment/vps-deploy.sh
set -euo pipefail
cd /opt/zapmass
echo "==> Atualizar código (main)"
if [ -d .git ]; then
  git fetch origin main
  git checkout main 2>/dev/null || git checkout -B main origin/main
  git pull --ff-only origin main
else
  echo "ERRO: /opt/zapmass sem .git — use File Manager ou git clone primeiro."
  exit 1
fi
echo "==> Verificar fix conexão visível"
n=$(grep -c syncConnectionsForOwner server/evolutionService.ts || true)
echo "syncConnectionsForOwner count=$n"
if [ "${n:-0}" -lt 1 ]; then
  echo "ERRO: código antigo ainda. Confirme push no GitHub e repita."
  exit 1
fi
echo "==> Deploy Docker"
chmod +x deployment/vps-deploy.sh
exec bash deployment/vps-deploy.sh
