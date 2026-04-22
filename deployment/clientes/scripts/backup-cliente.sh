#!/usr/bin/env bash
# Cria um tarball com os dados de um cliente (pasta data/) para arquivo ou restore.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/backup-cliente.sh <slug> [--destino /caminho]
#
# Por defeito grava em /opt/zapmass/backups/<slug>-<timestamp>.tar.gz.

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug> [--destino /caminho]"
    exit 2
fi
shift || true

DESTINO_DIR="${ZAPMASS_ROOT}/backups"
while [ $# -gt 0 ]; do
    case "$1" in
        --destino|-d) DESTINO_DIR="${2:-}"; shift 2;;
        *) err "Opcao desconhecida: $1"; exit 2;;
    esac
done

SLUG="$(normalizar_slug "$SLUG_RAW")"
if ! cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' nao existe."
    exit 1
fi

DATA_DIR="$(cliente_data "$SLUG")"
mkdir -p "$DESTINO_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
ARQUIVO="${DESTINO_DIR}/${SLUG}-${TS}.tar.gz"

log "A criar backup de ${DATA_DIR}..."
tar -czf "$ARQUIVO" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" \
    --warning=no-file-changed \
    --exclude='*/.wwebjs_cache' \
    || warn "tar retornou warnings mas o ficheiro foi criado."

ok "Backup gravado: ${ARQUIVO}"
du -h "$ARQUIVO" | awk '{print "  tamanho: " $1}'
