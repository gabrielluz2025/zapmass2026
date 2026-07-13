#!/usr/bin/env bash
# Corrige REDIS_URL legado (host.docker.internal) no .env principal e em todos os clientes.
# Uso: cd /opt/zapmass && bash deployment/fix-redis-url-all.sh
set -euo pipefail
cd /opt/zapmass

# shellcheck source=deployment/clientes/scripts/_comum.sh
. "$(dirname "$0")/clientes/scripts/_comum.sh"

echo "==> REDIS_URL ANTES:"
grep -hE '^[[:space:]]*(export[[:space:]]+)?REDIS_URL=' .env clientes/*/.env 2>/dev/null || true

echo "==> Corrigindo REDIS_URL (principal + clientes)"
corrigir_redis_url_todos

echo "==> REDIS_URL DEPOIS:"
grep -hE '^[[:space:]]*(export[[:space:]]+)?REDIS_URL=' .env clientes/*/.env 2>/dev/null || true

echo "==> Subindo Redis + stack principal"
docker compose up -d redis zapmass 2>/dev/null || true
docker compose up -d --force-recreate --no-deps zapmass 2>/dev/null || true

_shared_net="$(redis_compose_network 2>/dev/null || compose_shared_network 2>/dev/null || true)"
if [ -n "${_shared_net}" ]; then
  echo "==> Rede Redis detectada: ${_shared_net}"
else
  warn "Não foi possível detectar rede do Redis — clientes podem ficar isolados."
fi

if [ -d clientes ] && ls clientes/*/docker-compose.yml >/dev/null 2>&1; then
  read -r prod_slug prod_port _prod_dom <<<"$(resolver_cliente_producao)"
  for dir in clientes/*/; do
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    [ -f "${dir}docker-compose.yml" ] || continue
    echo "==> Recriando cliente ${slug}"
    recriar_cliente_compose "$dir" "$slug"
    if [ -n "${_shared_net}" ]; then
      docker network connect "${_shared_net}" "zapmass-cli-${slug}" 2>/dev/null \
        && log "Cliente ${slug} ligado manualmente a ${_shared_net}" \
        || true
    fi
    echo "==> REDIS_URL no container zapmass-cli-${slug}:"
    docker exec "zapmass-cli-${slug}" printenv REDIS_URL 2>/dev/null || warn "Container ${slug} sem REDIS_URL"
    echo "==> DNS redis dentro do container:"
    docker exec "zapmass-cli-${slug}" getent hosts redis 2>/dev/null || warn "Hostname redis não resolve em ${slug}"
  done
  echo "==> Health dispatch site publico (${prod_slug:-demo} :${prod_port:-3100})"
  sleep 8
  _dispatch="$(curl -sf --max-time 15 "http://127.0.0.1:${prod_port:-3100}/api/health/dispatch" 2>/dev/null || echo '{"ok":false}')"
  echo "${_dispatch}"
  echo ""
  if echo "${_dispatch}" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    ok "Motor de disparo OK em 127.0.0.1:${prod_port:-3100}"
    exit 0
  fi
  err "Motor de disparo ainda OFF — confira REDIS_URL e rede partilhada acima."
  exit 1
fi
