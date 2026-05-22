#!/usr/bin/env bash
# Corrige Evolution P1001 no Swarm: redeploy stack (tasks.postgres) + reinicia Evolution.
# Uso: cd /opt/zapmass && bash deployment/fix-evolution-now.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"

log() { echo "==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

cd "$ROOT"
chmod +x deployment/vps-deploy.sh deployment/recover-postgres-evolution.sh 2>/dev/null || true

log "Deploy stack Swarm (rede overlay + tasks.postgres)"
bash deployment/vps-deploy.sh

log "Reiniciar Evolution com URI corrigida"
bash deployment/recover-postgres-evolution.sh
