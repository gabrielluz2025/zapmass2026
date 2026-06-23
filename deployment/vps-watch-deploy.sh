#!/usr/bin/env bash
# Observa origin/main e aplica deploy quando houver commit novo.
# Uso: cron a cada 3 min na VPS (install-deploy-watch-cron.sh).
# Não depende de SSH entrada do GitHub Actions — a VPS puxa o código.
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
LOCK="/var/lock/zapmass-watch-deploy.lock"
LOG="${ZAPMASS_WATCH_DEPLOY_LOG:-/var/log/zapmass-watch-deploy.log}"

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

git fetch origin main --prune --quiet 2>>"${LOG}" || {
  echo "$(date -Is) AVISO: git fetch falhou" >>"${LOG}"
  exit 0
}

LOCAL="$(git rev-parse HEAD 2>/dev/null || echo '')"
REMOTE="$(git rev-parse origin/main 2>/dev/null || echo '')"

if [ -z "${REMOTE}" ] || [ "${LOCAL}" = "${REMOTE}" ]; then
  exit 0
fi

echo "$(date -Is) novo commit ${REMOTE:0:7} (local ${LOCAL:0:7}) — iniciando deploy" >>"${LOG}"
export GITHUB_EVENT_NAME="${GITHUB_EVENT_NAME:-watch}"
export GITHUB_ACTIONS="${GITHUB_ACTIONS:-false}"
export GHA_SHA="${REMOTE}"
export VITE_GIT_REF="${REMOTE:0:7}"

git checkout -f "${REMOTE}" >>"${LOG}" 2>&1
chmod +x deployment/vps-deploy.sh deployment/gha-healthcheck.sh 2>/dev/null || true

if bash deployment/vps-deploy.sh >>"${LOG}" 2>&1; then
  echo "$(date -Is) deploy OK ${REMOTE:0:7}" >>"${LOG}"
else
  echo "$(date -Is) deploy FALHOU ${REMOTE:0:7}" >>"${LOG}"
  exit 1
fi
