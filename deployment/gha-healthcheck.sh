#!/usr/bin/env bash
# Healthcheck longo para GitHub Actions (passo separado do docker build).
set -euo pipefail
cd /opt/zapmass

TRIES="${DEPLOY_HEALTH_TRIES:-200}"
WAIT_FIRST="${DEPLOY_HEALTH_INITIAL_WAIT:-60}"
EXPECTED="${VITE_GIT_REF:-${GHA_SHA:-}}"
EXPECTED_SHORT="${EXPECTED:0:7}"

# shellcheck source=deployment/clientes/scripts/_comum.sh
. "$(dirname "$0")/clientes/scripts/_comum.sh"

read -r PROD_SLUG PROD_PORT PROD_DOM <<<"$(resolver_cliente_producao)"
HP="${PROD_PORT:-${HOST_PORT:-3001}}"
PUBLIC_HOST="${PROD_DOM:-zap-mass.com}"

echo "==> gha-healthcheck: producao https://${PUBLIC_HOST} + local :${HP}"
echo "==> cliente=${PROD_SLUG:-?} ate ${TRIES} tentativas (~$((TRIES * 6))s)"
echo "==> versao esperada: ${EXPECTED:-?}"

sleep "${WAIT_FIRST}"

_version_matches() {
  local ver="$1"
  [ -z "${ver}" ] && return 1
  [ -z "${EXPECTED}" ] && return 0
  [ "${ver}" = "${EXPECTED}" ] && return 0
  [ "${ver}" = "${GITHUB_SHA:-}" ] && return 0
  [ -n "${EXPECTED_SHORT}" ] && [ "${ver}" = "${EXPECTED_SHORT}" ] && return 0
  [ -n "${EXPECTED_SHORT}" ] && [ "${ver:0:7}" = "${EXPECTED_SHORT}" ] && return 0
  return 1
}

_fetch_version() {
  local url="$1"
  curl -sf "$url" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true
}

_dispatch_ok() {
  local url="$1"
  local body
  body=$(curl -sf --max-time 15 "${url}" 2>/dev/null || echo "")
  [ -n "${body}" ] && echo "${body}" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'
}

_try_fix_dispatch_redis() {
  echo "==> motor de disparo (Redis) fora — tentando corrigir REDIS_URL + reiniciar servicos"
  if [ -f deployment/fix-redis-url-all.sh ]; then
    chmod +x deployment/fix-redis-url-all.sh
    bash deployment/fix-redis-url-all.sh || true
  elif [ -f deployment/fix-redis-url-compose.sh ]; then
    chmod +x deployment/fix-redis-url-compose.sh
    bash deployment/fix-redis-url-compose.sh || true
  fi
  docker compose up -d redis zapmass 2>/dev/null || true
  sleep 10
}

_verify_dispatch_or_fix() {
  local base="$1"
  local label="$2"
  if _dispatch_ok "${base}/api/health/dispatch"; then
    echo "OK: motor de disparo saudavel (${label})"
    return 0
  fi
  echo "AVISO: ${label} sem Redis/fila — tentando auto-correcao"
  _try_fix_dispatch_redis
  if _dispatch_ok "${base}/api/health/dispatch"; then
    echo "OK: motor de disparo recuperado (${label})"
    return 0
  fi
  echo "FALHA: motor de disparo ainda indisponivel (${label})"
  return 1
}

_poll() {
  local n="$1"
  local i code ver pub_code pub_ver
  for i in $(seq 1 "${n}"); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HP}/api/health" || echo 000)
    ver="$(_fetch_version "http://127.0.0.1:${HP}/api/health")"
    pub_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${PUBLIC_HOST}/api/health" 2>/dev/null || echo 000)
    pub_ver="$(_fetch_version "https://${PUBLIC_HOST}/api/health")"
    echo "tentativa ${i}/${n}: local HTTP ${code} v=${ver:-?} | public HTTP ${pub_code} v=${pub_ver:-?}"
    if [ "${pub_code}" = "200" ] && _version_matches "${pub_ver}"; then
      if _verify_dispatch_or_fix "https://${PUBLIC_HOST}" "publico"; then
        echo "OK: producao saudavel (https://${PUBLIC_HOST} version=${pub_ver})"
        exit 0
      fi
    fi
    if [ "${code}" = "200" ] && _version_matches "${ver}"; then
      if _verify_dispatch_or_fix "http://127.0.0.1:${HP}" "local"; then
        echo "OK: API local saudavel (127.0.0.1:${HP} version=${ver})"
        exit 0
      fi
    fi
    if [ "${pub_code}" = "200" ] && [ -n "${EXPECTED}" ] && [ -n "${pub_ver}" ]; then
      echo "AVISO: public HTTP 200 mas version=${pub_ver} != esperado ${EXPECTED}"
    elif [ "${code}" = "200" ] && [ -n "${EXPECTED}" ] && [ -n "${ver}" ]; then
      echo "AVISO: local HTTP 200 mas version=${ver} != esperado ${EXPECTED}"
    fi
    sleep 6
  done
  return 1
}

if _poll "${TRIES}"; then
  exit 0
fi

echo "==> health falhou — tentar recover cliente ${PROD_SLUG} + swarm"
export GHA_SHA="${GHA_SHA:-$(git rev-parse HEAD 2>/dev/null || echo '')}"
if [ -n "${PROD_SLUG:-}" ] && cliente_existe "${PROD_SLUG}"; then
  CLIENT_DIR="$(cliente_dir "${PROD_SLUG}")"
  if recriar_cliente_compose "$CLIENT_DIR" "${PROD_SLUG}" \
    && aguardar_health_cliente_versao "${PROD_SLUG}" "${HP}" "${EXPECTED}" 240; then
    pub_ver="$(_fetch_version "https://${PUBLIC_HOST}/api/health")"
    if _version_matches "${pub_ver}"; then
      echo "OK: producao recuperada apos recreate do cliente ${PROD_SLUG}"
      exit 0
    fi
  fi
fi

if [ -f deployment/recover-api-swarm.sh ]; then
  chmod +x deployment/recover-api-swarm.sh
  bash deployment/recover-api-swarm.sh && exit 0
fi

echo "FALHA: site publico sem versao ${EXPECTED} apos recover"
exit 1
