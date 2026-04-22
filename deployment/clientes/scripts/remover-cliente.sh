#!/usr/bin/env bash
# Remove uma instancia de cliente do ZapMass.
# Por defeito MANTEM os dados do cliente em clientes/<slug>/data.backup-<timestamp>
# (para poderes restaurar se foi engano). Usa --apagar-dados para apagar mesmo.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/remover-cliente.sh <slug> [--apagar-dados]

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug> [--apagar-dados]"
    exit 2
fi
shift || true

APAGAR_DADOS=0
while [ $# -gt 0 ]; do
    case "$1" in
        --apagar-dados) APAGAR_DADOS=1; shift;;
        *) err "Opcao desconhecida: $1"; exit 2;;
    esac
done

SLUG="$(normalizar_slug "$SLUG_RAW")"

if ! cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' nao existe."
    exit 1
fi

DIR="$(cliente_dir "$SLUG")"
DOMINIO="$(grep -E '^PUBLIC_URL=' "${DIR}/.env" | sed 's#^PUBLIC_URL=https\?://##' | head -n1)"

log "A parar e remover container zapmass-cli-${SLUG}..."
(cd "$DIR" && docker compose down -v) || warn "docker compose down falhou; segue-se."

log "A remover config Nginx..."
rm -f "${NGINX_ENABLED}/zapmass-${SLUG}" "${NGINX_AVAILABLE}/zapmass-${SLUG}"
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    ok "Nginx recarregado."
else
    warn "nginx -t falhou apos remover; verifica manualmente."
fi

if [ "$APAGAR_DADOS" -eq 1 ]; then
    log "A apagar dados do cliente (definitivo)..."
    rm -rf "$DIR"
    ok "Cliente ${SLUG} completamente removido."
else
    local_backup="${CLIENTES_DIR}/${SLUG}.removido-$(date +%Y%m%d-%H%M%S)"
    mv "$DIR" "$local_backup"
    ok "Cliente removido. Dados preservados em: ${local_backup}"
    echo "  Para apagar definitivamente: rm -rf ${local_backup}"
fi

if [ -n "${DOMINIO:-}" ]; then
    echo
    echo "Certificado Let's Encrypt de ${DOMINIO} nao foi removido automaticamente."
    echo "Para remover: sudo certbot delete --cert-name ${DOMINIO}"
fi
