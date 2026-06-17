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

if [ "$APPLY" = "--apply" ]; then
    ok "connections_settings.json atualizado (efeito imediato — sem reiniciar API)."
    ok "Ctrl+Shift+R no browser. Se ainda aparecer canal errado, rode:"
    echo "  sudo bash deployment/clientes/scripts/corrigir-502.sh ${SLUG}"
    echo "  (rebuild da imagem + recria container — evita 502 por hot-patch antigo)"
fi
