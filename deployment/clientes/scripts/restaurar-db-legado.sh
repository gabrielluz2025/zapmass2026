#!/usr/bin/env bash
# Restaura ZAPMASS_DATABASE_URL do backup mais recente (cliente legado em zapmass_db).
#
# USO:
#   sudo bash restaurar-db-legado.sh demo
#   sudo bash restaurar-db-legado.sh demo --db zapmass_db

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

SLUG="$(normalizar_slug "${1:-}")"
TARGET_DB="${2:-}"
if [ -z "$SLUG" ]; then
    err "Uso: $0 <slug> [--db nome_base]"
    exit 2
fi
shift || true
while [ $# -gt 0 ]; do
    case "$1" in
        --db) TARGET_DB="${2:-}"; shift 2;;
        *) err "Opção desconhecida: $1"; exit 2;;
    esac
done

ENV_FILE="$(cliente_env "$SLUG")"
if [ ! -f "$ENV_FILE" ]; then
    err "Sem .env: ${ENV_FILE}"
    exit 1
fi

if [ -z "$TARGET_DB" ]; then
    bak="$(ls -t "${ENV_FILE}.bak."* 2>/dev/null | head -n1 || true)"
    if [ -n "$bak" ]; then
        TARGET_DB="$(grep -E '^ZAPMASS_DATABASE_URL=' "$bak" 2>/dev/null | sed 's#.*/##' | head -n1 || true)"
    fi
fi
TARGET_DB="${TARGET_DB:-zapmass_db}"

NEW_URL="postgresql://postgres:$(ler_postgres_password)@postgres:5432/${TARGET_DB}"
log "A definir ${ENV_FILE} → ${TARGET_DB}"
sed -i "s|^ZAPMASS_DATABASE_URL=.*|ZAPMASS_DATABASE_URL=${NEW_URL}|" "$ENV_FILE"
chmod 600 "$ENV_FILE"

DIR="$(cliente_dir "$SLUG")"
(cd "$DIR" && docker compose up -d --force-recreate)
ok "Cliente ${SLUG} a usar ${TARGET_DB}. Verifique: docker exec zapmass-cli-${SLUG} printenv ZAPMASS_DATABASE_URL"
