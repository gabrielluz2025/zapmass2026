#!/usr/bin/env bash
# Instala zona de rate limit Nginx (uma vez na VPS).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

DEST="/etc/nginx/conf.d/zapmass-rate-limit.conf"
SRC="${TEMPLATES_DIR}/nginx-rate-limit.conf"

if [ -f "$DEST" ]; then
    ok "Rate limit já configurado: ${DEST}"
    exit 0
fi

cp "$SRC" "$DEST"
chmod 644 "$DEST"
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    ok "Rate limit Nginx instalado (${DEST})."
else
    rm -f "$DEST"
    err "nginx -t falhou ao instalar rate limit."
    exit 1
fi
