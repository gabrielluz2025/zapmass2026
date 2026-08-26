#!/usr/bin/env bash
# Cria bancos evogo_auth / evogo_users se o volume Postgres já existia antes da migração Go.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_PASS="${POSTGRES_PASSWORD:-evolution-secure-pass-2026}"

pg_exec() {
  local sql="$1"
  if docker ps --format '{{.Names}}' | grep -qE '^zapmass.*postgres|postgres'; then
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

for db in evogo_auth evogo_users; do
  exists="$(pg_exec "SELECT 1 FROM pg_database WHERE datname='${db}'")"
  if echo "$exists" | grep -q 1; then
    echo "==> Postgres: ${db} já existe"
  else
    echo "==> Postgres: criando ${db}…"
    pg_exec "CREATE DATABASE ${db};"
  fi
done

echo "==> Bancos Evolution Go OK"
