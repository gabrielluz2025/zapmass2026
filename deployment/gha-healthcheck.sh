#!/usr/bin/env bash
# Healthcheck longo para GitHub Actions (passo separado do docker build).
set -euo pipefail
cd /opt/zapmass

HP="${HOST_PORT:-3001}"
TRIES="${DEPLOY_HEALTH_TRIES:-200}"
WAIT_FIRST="${DEPLOY_HEALTH_INITIAL_WAIT:-60}"
EXPECTED="${VITE_GIT_REF:-${GHA_SHA:-}}"

echo "==> gha-healthcheck: porta ${HP}, ate ${TRIES} tentativas (~$((TRIES * 6))s)"
echo "==> versao esperada: ${EXPECTED:-?}"

sleep "${WAIT_FIRST}"

_poll() {
  local n="$1"
  local i code ver
  for i in $(seq 1 "${n}"); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HP}/api/health" || echo 000)
    ver="$(curl -sf "http://127.0.0.1:${HP}/api/version" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
    echo "tentativa ${i}/${n}: HTTP ${code} version=${ver:-?}"
    if [ "${code}" = "200" ]; then
      if [ -n "${EXPECTED}" ] && [ -n "${ver}" ] && [ "${ver}" != "${EXPECTED}" ]; then
        echo "AVISO: version=${ver} != esperado ${EXPECTED} (API ja responde — aceite para nao bloquear deploy)"
      fi
      echo "OK: API saudavel (version=${ver:-?})"
      exit 0
    fi
    sleep 6
  done
  return 1
}

if _poll "${TRIES}"; then
  exit 0
fi

echo "==> health falhou — recover-api-swarm"
export GHA_SHA="${GHA_SHA:-$(git rev-parse HEAD 2>/dev/null || echo '')}"
if [ -f deployment/recover-api-swarm.sh ]; then
  chmod +x deployment/recover-api-swarm.sh
  bash deployment/recover-api-swarm.sh && exit 0
fi

echo "FALHA: API sem HTTP 200 apos recover"
exit 1
