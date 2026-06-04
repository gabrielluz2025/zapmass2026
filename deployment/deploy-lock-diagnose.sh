#!/usr/bin/env bash
# Diagnóstico do lock de deploy (quando manual-pull-deploy fica 600s aguardando).
set -euo pipefail
LOCK="${ZAPMASS_DEPLOY_LOCK:-/var/lock/zapmass-deploy.lock}"
echo "==> Lock: ${LOCK}"
if [ -f "${LOCK}" ]; then
  ls -la "${LOCK}" 2>/dev/null || true
else
  echo "    (arquivo ainda não existe — nenhum deploy com lock ativo neste momento)"
fi
if command -v fuser >/dev/null 2>&1; then
  echo "==> Processos com o lock (fuser):"
  fuser -v "${LOCK}" 2>&1 || echo "    (nenhum)"
else
  echo "==> AVISO: instale psmisc para fuser (apt install psmisc)"
fi
echo "==> Processos de deploy ZapMass:"
ps aux | grep -E '[v]ps-deploy\.sh|[m]anual-pull-deploy|[e]nsure-git-main' || echo "    (nenhum visível)"
