#!/usr/bin/env bash
# Cria DBs de homologação se o volume Postgres já existia antes desta feature.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^POSTGRES_PASSWORD=' .env | sed -E 's/^[[:space:]]*export[[:space:]]+//') || true
  set +a
fi

PG_PASS="${POSTGRES_PASSWORD:-evolution-secure-pass-2026}"

pg_exec() {
  local sql="$1"
  if docker ps --format '{{.Names}}' | grep -qE 'postgres'; then
    local cid
    cid="$(docker ps --format '{{.Names}}' | grep -E 'postgres' | head -1)"
    docker exec "$cid" psql -U postgres -tc "$sql" 2>/dev/null || true
    return 0
  fi
  if docker service ls --format '{{.Name}}' 2>/dev/null | grep -q '^zapmass_postgres$'; then
    docker run --rm --network zapmass_zapmass_internal postgres:15-alpine \
      psql "postgresql://postgres:${PG_PASS}@tasks.postgres:5432/postgres" -tc "$sql" 2>/dev/null || true
  fi
}

for db in zapmass_homolog evogo_homolog_auth evogo_homolog_users; do
  exists="$(pg_exec "SELECT 1 FROM pg_database WHERE datname='${db}'")"
  if echo "$exists" | grep -q 1; then
    echo "==> Postgres: ${db} já existe"
  else
    echo "==> Postgres: criando ${db}…"
    pg_exec "CREATE DATABASE ${db};"
  fi
done

echo "==> Bancos homologação OK"
