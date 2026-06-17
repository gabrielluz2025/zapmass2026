#!/usr/bin/env bash
# Isola canais/conversas por tenant (Patrícia, Sylvester, remove órfãos offline).
# Usa script Python no host (NFKC Unicode) — não depende da versão da imagem Docker.
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
DATA_DIR="$(cliente_data "$SLUG")"
PY="${ZAPMASS_ROOT}/scripts/fix-connection-owners.py"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    err "Container ${CONTAINER} não está a correr."
    exit 1
fi

if [ ! -f "$PY" ]; then
    err "Script ausente: $PY (faça git pull origin main)"
    exit 1
fi

log "=== Isolamento de canais — ${SLUG} ==="

ARGS=("$DATA_DIR")
if [ "$APPLY" = "--apply" ]; then
    ARGS+=(--apply)
    warn "Modo APPLY — altera ${DATA_DIR}/connections_settings.json"
else
    log "Simulação (dry-run). Use: $0 ${SLUG} --apply"
fi

python3 "$PY" "${ARGS[@]}"

# Copiar módulos TS atualizados para o container (boot reconcile + filtro servidor)
for f in \
    "${ZAPMASS_ROOT}/server/reconcileConnectionOwners.ts" \
    "${ZAPMASS_ROOT}/server/connectionScopeServer.ts" \
    "${ZAPMASS_ROOT}/src/utils/normalizeConnectionLabel.ts"; do
    if [ -f "$f" ]; then
        rel="${f#${ZAPMASS_ROOT}/}"
        docker exec "$CONTAINER" mkdir -p "/app/$(dirname "$rel")"
        docker cp "$f" "${CONTAINER}:/app/${rel}"
    fi
done

if [ "$APPLY" = "--apply" ]; then
    log "A reiniciar ${CONTAINER}..."
    docker restart "$CONTAINER" >/dev/null
    ok "Feito. Ctrl+Shift+R no browser — Gabriel não deve ver o chip da Patrícia."
fi
