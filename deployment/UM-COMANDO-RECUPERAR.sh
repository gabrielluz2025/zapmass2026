#!/usr/bin/env bash
# Uma linha no terminal Hostinger (hPanel) como root — migra Swarm→Compose e sobe API:
#   curl -fsSL https://raw.githubusercontent.com/gabrielluz2025/zapmass2026/main/deployment/UM-COMANDO-RECUPERAR.sh | bash
set -euo pipefail
cd /opt/zapmass
git fetch --all --prune
git checkout -f main 2>/dev/null || git checkout -f origin/main
git pull --ff-only origin main || git checkout -f origin/main
chmod +x deployment/migrar-swarm-para-compose.sh deployment/SOS-API-FORA.sh deployment/recover-api-swarm.sh deployment/vps-deploy.sh
exec bash deployment/migrar-swarm-para-compose.sh
