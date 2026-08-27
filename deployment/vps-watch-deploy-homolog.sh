#!/usr/bin/env bash
# Observa origin/develop e aplica deploy homolog quando houver commit novo.
# Não depende de SSH entrada do GitHub Actions — a VPS puxa o código.
# Uso: cron a cada 3 min (install-homolog-watch-cron.sh).
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
LOCK="/var/lock/zapmass-watch-deploy-homolog.lock"
LOG="${ZAPMASS_WATCH_DEPLOY_HOMOLOG_LOG:-/var/log/zapmass-watch-deploy-homolog.log}"

mkdir -p /var/lock "$(dirname "$LOG")" 2>/dev/null || true

exec 9>"${LOCK}"
if ! flock -n 9; then
  exit 0
fi

cd "${ROOT}"
if [ ! -d .git ]; then
  echo "$(date -Is) ERRO: ${ROOT} sem repositório git" >>"${LOG}"
  exit 1
fi

git fetch origin develop --prune --quiet 2>>"${LOG}" || {
  echo "$(date -Is) AVISO: git fetch develop falhou" >>"${LOG}"
  exit 0
}

LOCAL="$(git rev-parse develop 2>/dev/null || git rev-parse HEAD 2>/dev/null || echo '')"
REMOTE="$(git rev-parse origin/develop 2>/dev/null || echo '')"

if [ -z "${REMOTE}" ] || [ "${LOCAL}" = "${REMOTE}" ]; then
  exit 0
fi

echo "$(date -Is) novo commit develop ${REMOTE:0:7} (local ${LOCAL:0:7}) — homolog deploy" >>"${LOG}"
export GITHUB_EVENT_NAME="${GITHUB_EVENT_NAME:-watch-homolog}"
export GITHUB_ACTIONS="${GITHUB_ACTIONS:-false}"
export SKIP_GIT_SYNC=1

chmod +x deployment/vps-deploy-homolog.sh deployment/ensure-git-develop.sh 2>/dev/null || true

if bash deployment/ensure-git-develop.sh >>"${LOG}" 2>&1 && bash deployment/vps-deploy-homolog.sh >>"${LOG}" 2>&1; then
  echo "$(date -Is) homolog deploy OK ${REMOTE:0:7}" >>"${LOG}"
else
  echo "$(date -Is) homolog deploy FALHOU ${REMOTE:0:7}" >>"${LOG}"
  exit 1
fi
