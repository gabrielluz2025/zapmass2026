#!/usr/bin/env bash
# Redefine senha de owner VPS (zapmass.users) — útil quando o login falha após migração.
#
# USO:
#   sudo bash redefinir-senha-owner.sh <email> <nova_senha> [slug]
#
# EXEMPLO:
#   sudo bash redefinir-senha-owner.sh festaimportgabriel@gmail.com 'MinhaSenha2026' demo

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

EMAIL="${1:-}"
PASS="${2:-}"
SLUG="$(normalizar_slug "${3:-demo}")"

if [ -z "$EMAIL" ] || [ -z "$PASS" ]; then
    err "Uso: $0 <email> <nova_senha> [slug]"
    exit 2
fi
if [ "${#PASS}" -lt 8 ]; then
    err "A senha deve ter no mínimo 8 caracteres."
    exit 2
fi

CONTAINER="zapmass-cli-${SLUG}"
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'zapmass-zapmass-1'; then
        CONTAINER="zapmass-zapmass-1"
    else
        err "Container ${CONTAINER} (ou zapmass-zapmass-1) não está a correr."
        exit 1
    fi
fi

RESET_SCRIPT="${ZAPMASS_ROOT}/scripts/reset-vps-user-password.ts"
if [ ! -f "$RESET_SCRIPT" ]; then
    err "Script ausente: ${RESET_SCRIPT} (faça git pull origin main)"
    exit 1
fi

# Imagens antigas não incluem o script — copia do host (funciona sem rebuild).
if ! docker exec "$CONTAINER" test -f /app/scripts/reset-vps-user-password.ts 2>/dev/null; then
    log "Script ausente na imagem — a copiar do host..."
    docker exec "$CONTAINER" mkdir -p /app/scripts
    docker cp "$RESET_SCRIPT" "${CONTAINER}:/app/scripts/reset-vps-user-password.ts"
fi

log "A redefinir senha de ${EMAIL} via ${CONTAINER} ..."
docker exec \
    -e "RESET_EMAIL=${EMAIL}" \
    -e "RESET_PASS=${PASS}" \
    "$CONTAINER" \
    npx tsx scripts/reset-vps-user-password.ts

ok "Feito. Teste login em https://zap-mass.com com a nova senha."
