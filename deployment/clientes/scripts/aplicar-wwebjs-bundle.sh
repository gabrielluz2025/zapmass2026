#!/usr/bin/env bash
# Garante WWEBJS_WEB_VERSION_URL no .env da instalação principal e em cada cliente
# (containers antigos sem esta variável). Idempotente.
#
# USO (na VPS):
#   sudo bash /opt/zapmass/deployment/clientes/scripts/aplicar-wwebjs-bundle.sh
#
# Lê o valor recomendado de deployment/wwebjs-default-bundle.env (raiz do repo).

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

DEFAULT_FILE="${ZAPMASS_ROOT}/deployment/wwebjs-default-bundle.env"
if [ ! -f "$DEFAULT_FILE" ]; then
    err "Ficheiro em falta: ${DEFAULT_FILE}"
    exit 1
fi
WWEBJS_LINE="$(grep -E '^[[:space:]]*WWEBJS_WEB_VERSION_URL[[:space:]]*=' "$DEFAULT_FILE" | head -n1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
if [ -z "$WWEBJS_LINE" ]; then
    err "Não encontrei WWEBJS_WEB_VERSION_URL em ${DEFAULT_FILE}"
    exit 1
fi

append_wwebjs_if_missing() {
    local env_path="$1"
    [ -f "$env_path" ] || return 0
    if grep -qE '^[[:space:]]*WWEBJS_WEB_VERSION_URL[[:space:]]*=' "$env_path" 2>/dev/null; then
        return 0
    fi
    printf '\n# WhatsApp Web bundle (deployment/wwebjs-default-bundle.env)\n%s\n' "$WWEBJS_LINE" >> "$env_path"
    return 1
}

ROOT_ENV="${ZAPMASS_ROOT}/.env"
if [ -f "$ROOT_ENV" ]; then
    log "Instância principal: ${ROOT_ENV}"
    if append_wwebjs_if_missing "$ROOT_ENV"; then
        ok "  já tinha WWEBJS_WEB_VERSION_URL."
    else
        ok "  acrescentada WWEBJS_WEB_VERSION_URL — reinicie a stack principal (docker compose / swarm)."
    fi
else
    warn "Sem ${ROOT_ENV} — ignore se não usa .env na raiz."
fi

if [ ! -d "$CLIENTES_DIR" ]; then
    echo
    ok "Sem pasta clientes. Concluído."
    exit 0
fi

shopt -s nullglob
for DIR in "${CLIENTES_DIR}"/*/; do
    SLUG="$(basename "$DIR")"
    COMPOSE="${DIR}docker-compose.yml"
    ENV="${DIR}.env"
    case "$SLUG" in *removido*) continue ;; esac
    [ -f "$COMPOSE" ] || continue
    [ -f "$ENV" ] || continue

    log "Cliente: ${C_BOLD}${SLUG}${C_END}"
    if append_wwebjs_if_missing "$ENV"; then
        ok "  .env já configurado."
    else
        log "  reiniciando container..."
        (cd "$DIR" && docker compose up -d)
        ok "  actualizado."
    fi
done

echo
ok "Concluído. Se alterou a raiz, faça deploy/restart da API e do wa-worker conforme o teu modo (compose ou Swarm)."
