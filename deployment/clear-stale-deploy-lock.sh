#!/usr/bin/env bash
# Libera lock órfão — use SOMENTE após deploy-lock-diagnose.sh mostrar que não há deploy ativo.
set -euo pipefail
LOCK="${ZAPMASS_DEPLOY_LOCK:-/var/lock/zapmass-deploy.lock}"
if command -v fuser >/dev/null 2>&1; then
  PIDS="$(fuser "${LOCK}" 2>/dev/null | tr -s ' ' | xargs echo || true)"
  if [ -n "${PIDS}" ]; then
    echo "ERRO: ainda há processo(s) com o lock: ${PIDS}"
    echo "Se o deploy travou (docker build), pode encerrar com: kill ${PIDS}"
    echo "Depois rode de novo: bash deployment/manual-pull-deploy.sh"
    exit 1
  fi
fi
if pgrep -f 'deployment/vps-deploy\.sh|manual-pull-deploy\.sh' >/dev/null 2>&1; then
  echo "ERRO: ainda há script de deploy em execução (pgrep)."
  bash "$(dirname "$0")/deploy-lock-diagnose.sh"
  exit 1
fi
rm -f "${LOCK}"
echo "OK: lock removido. Pode rodar: cd /opt/zapmass && bash deployment/manual-pull-deploy.sh"
