#!/usr/bin/env bash
# Uma linha no terminal Hostinger (hPanel) como root — recupera API 0/1 + Redis:
#   curl -fsSL https://raw.githubusercontent.com/gabrielluz2025/zapmass2026/main/deployment/UM-COMANDO-RECUPERAR.sh | bash
set -euo pipefail
cd /opt/zapmass
git fetch --all --prune
git checkout -f main 2>/dev/null || git checkout -f origin/main
git pull --ff-only origin main || git checkout -f origin/main
chmod +x deployment/recover-api-swarm.sh
exec bash deployment/recover-api-swarm.sh
