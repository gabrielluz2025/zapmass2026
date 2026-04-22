#!/usr/bin/env bash
# Para o container de um cliente (mantem dados e config).
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/parar-cliente.sh <slug>

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug>"
    exit 2
fi
SLUG="$(normalizar_slug "$SLUG_RAW")"

if ! cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' nao existe."
    exit 1
fi

DIR="$(cliente_dir "$SLUG")"
log "A parar zapmass-cli-${SLUG}..."
(cd "$DIR" && docker compose stop)
ok "Cliente ${SLUG} parado. Reinicia com iniciar-cliente.sh."
