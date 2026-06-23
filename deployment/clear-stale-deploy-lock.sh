#!/usr/bin/env bash
# Libera lock órfão — com DEPLOY_FORCE=1 aguarda deploy ativo em vez de falhar na hora.
set -euo pipefail
LOCK="${ZAPMASS_DEPLOY_LOCK:-/var/lock/zapmass-deploy.lock}"

if [ "${DEPLOY_FORCE:-0}" = "1" ]; then
  bash "$(dirname "$0")/wait-for-deploy-lock.sh" && exit 0
fi

if command -v fuser >/dev/null 2>&1 && [ -f "${LOCK}" ]; then
  PIDS="$(fuser "${LOCK}" 2>/dev/null | tr -s ' ' | xargs echo || true)"
  if [ -n "${PIDS}" ]; then
    echo "ERRO: ainda há processo(s) com o lock: ${PIDS}"
    echo "Outro deploy está rodando — aguarde ou use:"
    echo "  DEPLOY_FORCE=1 cd /opt/zapmass && bash deployment/deploy-completo.sh"
    exit 1
  fi
fi
if pgrep -f 'deployment/vps-deploy\.sh|manual-pull-deploy\.sh|deploy-completo\.sh' >/dev/null 2>&1; then
  echo "ERRO: ainda há script de deploy em execução (pgrep)."
  bash "$(dirname "$0")/deploy-lock-diagnose.sh"
  echo "Use: DEPLOY_FORCE=1 cd /opt/zapmass && bash deployment/deploy-completo.sh"
  exit 1
fi
rm -f "${LOCK}"
echo "OK: lock removido. Pode rodar: cd /opt/zapmass && bash deployment/deploy-completo.sh"
