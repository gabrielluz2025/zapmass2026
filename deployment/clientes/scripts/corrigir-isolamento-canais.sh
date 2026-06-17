#!/usr/bin/env bash
# Isola canais e conversas por tenant (Patrícia, Sylvester, remove órfãos offline).
#
# USO:
#   sudo bash corrigir-isolamento-canais.sh demo          # simula
#   sudo bash corrigir-isolamento-canais.sh demo --apply  # aplica

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

SLUG="$(normalizar_slug "${1:-demo}")"
APPLY="${2:-}"

if ! cliente_existe "$SLUG"; then
    err "Cliente '${SLUG}' não encontrado."
    exit 1
fi

CONTAINER="zapmass-cli-${SLUG}"
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    err "Container ${CONTAINER} não está a correr."
    exit 1
fi

log "=== Isolamento de canais — ${SLUG} ==="

# Garantir script no container (imagem pode estar atrás do git)
if [ -f "${ZAPMASS_ROOT}/scripts/isolate-tenant-channels.ts" ]; then
    docker cp "${ZAPMASS_ROOT}/scripts/isolate-tenant-channels.ts" "${CONTAINER}:/app/scripts/isolate-tenant-channels.ts"
fi

ARGS=()
if [ "$APPLY" = "--apply" ]; then
    ARGS+=(--apply)
    warn "Modo APPLY — altera connections_settings.json e Postgres."
else
    log "Simulação (dry-run). Use: $0 ${SLUG} --apply"
fi

docker exec "$CONTAINER" npx tsx scripts/isolate-tenant-channels.ts "${ARGS[@]}"

if [ "$APPLY" = "--apply" ]; then
    log "A reiniciar ${CONTAINER}..."
    docker restart "$CONTAINER" >/dev/null
    ok "Feito. Ctrl+Shift+R no browser — Gabriel não deve ver conversas da Patrícia."
fi
