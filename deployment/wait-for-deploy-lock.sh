#!/usr/bin/env bash
# Aguarda outro deploy ZapMass terminar (lock livre + sem scripts ativos).
set -euo pipefail
LOCK="${ZAPMASS_DEPLOY_LOCK:-/var/lock/zapmass-deploy.lock}"
WAIT_SEC="${DEPLOY_LOCK_WAIT_SEC:-900}"
STEP="${DEPLOY_LOCK_WAIT_STEP:-15}"

has_deploy_procs() {
  local pids pid my_pid=$$ ppid=${PPID:-0}
  pids=$(pgrep -f 'deployment/vps-deploy\.sh|deployment/deploy-completo\.sh|manual-pull-deploy\.sh|vps-watch-deploy\.sh' 2>/dev/null || true)
  [ -z "$pids" ] && return 1
  while read -r pid; do
    [ -z "$pid" ] && continue
    # Ignora este shell e o pai — senão DEPLOY_FORCE=1 detecta a si mesmo e espera 900s.
    [ "$pid" = "$my_pid" ] && continue
    [ "$pid" = "$ppid" ] && continue
    return 0
  done <<< "$pids"
  return 1
}

lock_busy() {
  if command -v fuser >/dev/null 2>&1 && [ -f "${LOCK}" ]; then
    fuser "${LOCK}" >/dev/null 2>&1 && return 0
  fi
  has_deploy_procs
}

if ! lock_busy; then
  echo "OK: nenhum deploy em execução."
  exit 0
fi

echo "==> Outro deploy em execução — aguardando até ${WAIT_SEC}s…"
echo "==> Diagnóstico: bash deployment/deploy-lock-diagnose.sh"

elapsed=0
while [ "${elapsed}" -lt "${WAIT_SEC}" ]; do
  if ! lock_busy; then
    rm -f "${LOCK}" 2>/dev/null || true
    echo "OK: deploy anterior concluído (${elapsed}s)."
    exit 0
  fi
  if [ "${elapsed}" = "0" ] || [ $((elapsed % 60)) -eq 0 ]; then
    echo "==> aguardando… ${elapsed}s / ${WAIT_SEC}s"
    bash "$(dirname "$0")/deploy-lock-diagnose.sh" 2>/dev/null | head -8 || true
  fi
  sleep "${STEP}"
  elapsed=$((elapsed + STEP))
done

echo "ERRO: deploy anterior ainda ativo após ${WAIT_SEC}s."
bash "$(dirname "$0")/deploy-lock-diagnose.sh"
echo ""
echo "Se travou de verdade (sem docker build ativo), encerre e tente de novo:"
echo "  pkill -f 'deployment/vps-deploy.sh' || true"
echo "  rm -f ${LOCK}"
echo "  cd /opt/zapmass && DEPLOY_FORCE=1 bash deployment/deploy-completo.sh"
exit 1
