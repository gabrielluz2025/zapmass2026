#!/usr/bin/env bash
# Corrige REDIS_URL legado (host.docker.internal) no .env principal e em todos os clientes.
# Uso: cd /opt/zapmass && bash deployment/fix-redis-url-all.sh
set -euo pipefail
cd /opt/zapmass

# shellcheck source=deployment/clientes/scripts/_comum.sh
. "$(dirname "$0")/clientes/scripts/_comum.sh"

echo "==> Corrigindo REDIS_URL (principal + clientes)"
corrigir_redis_url_todos

echo "==> Subindo Redis + stack principal"
docker compose up -d redis zapmass 2>/dev/null || true

if [ -d clientes ] && ls clientes/*/docker-compose.yml >/dev/null 2>&1; then
  read -r prod_slug prod_port _prod_dom <<<"$(resolver_cliente_producao)"
  for dir in clientes/*/; do
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    [ -f "${dir}docker-compose.yml" ] || continue
    echo "==> Recriando cliente ${slug}"
    recriar_cliente_compose "$dir" "$slug"
  done
  echo "==> Health dispatch site publico (${prod_slug:-demo} :${prod_port:-3100})"
  sleep 8
  curl -s "http://127.0.0.1:${prod_port:-3100}/api/health/dispatch" || true
  echo ""
fi
