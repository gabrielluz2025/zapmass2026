#!/usr/bin/env bash
# Processa fila de provisionamento pós-pagamento (JSON em /opt/zapmass/provision-queue/pending/).
#
# USO:
#   sudo bash processar-fila-provision.sh
#   sudo bash processar-fila-provision.sh --dry-run
#
# Cron (recomendado): setup-provision-cron.sh

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

QUEUE_ROOT="${ZAPMASS_PROVISION_QUEUE_DIR:-/opt/zapmass/provision-queue}"
PENDING_DIR="${QUEUE_ROOT}/pending"
DONE_DIR="${QUEUE_ROOT}/done"
FAILED_DIR="${QUEUE_ROOT}/failed"
DOMINIO_RAIZ="${ZAPMASS_DOMINIO_RAIZ:-zap-mass.com}"
DRY_RUN=0

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift;;
        *) shift;;
    esac
done

mkdir -p "$PENDING_DIR" "$DONE_DIR" "$FAILED_DIR"
chmod 750 "$QUEUE_ROOT" "$PENDING_DIR" "$DONE_DIR" "$FAILED_DIR" 2>/dev/null || true

if [ ! -d "$PENDING_DIR" ] || [ -z "$(ls -A "$PENDING_DIR" 2>/dev/null || true)" ]; then
    log "Fila de provisionamento vazia (${PENDING_DIR})."
    exit 0
fi

_slug_disponivel() {
    local base="$1"
    local slug try n=0
    slug="$(normalizar_slug "$base" 2>/dev/null || true)"
    [ -n "$slug" ] || return 1
    case "$slug" in
        demo|admin|api|www|redis|postgres|zapmass|mail|ftp|test|staging|prod|production)
            slug="${slug}-cli"
            ;;
    esac
    try="$slug"
    while cliente_existe "$try" || [ -f "${DONE_DIR}/${try}.slug" ]; do
        n=$((n + 1))
        try="${slug}-${n}"
        [ "$n" -lt 50 ] || return 1
    done
    printf '%s' "$try"
}

_ler_json() {
    local file="$1"
    local key="$2"
    python3 - "$file" "$key" <<'PY' 2>/dev/null || true
import json, sys
path, key = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    d = json.load(f)
print(d.get(key, "") or "")
PY
}

for job in "${PENDING_DIR}"/*.json; do
    [ -f "$job" ] || continue
    uid="$(_ler_json "$job" uid)"
    email="$(_ler_json "$job" email)"
    display_name="$(_ler_json "$job" displayName)"
    tier="$(_ler_json "$job" infraTier)"
    suggested="$(_ler_json "$job" suggestedSlug)"
    tier="${tier:-starter}"
    case "$tier" in
        starter|pro|business) ;;
        *) tier="starter";;
    esac

    if [ -f "${DONE_DIR}/${uid}.json" ]; then
        log "UID ${uid} já provisionado — removendo pending duplicado."
        rm -f "$job"
        continue
    fi

    base_slug="${suggested:-}"
    if [ -z "$base_slug" ] && [ -n "$email" ]; then
        base_slug="${email%%@*}"
    fi
    if [ -z "$base_slug" ]; then
        base_slug="cliente-${uid:0:8}"
    fi

    slug="$(_slug_disponivel "$base_slug")"
    if [ -z "$slug" ]; then
        err "Sem slug livre para UID ${uid} (base=${base_slug})."
        mv -f "$job" "${FAILED_DIR}/$(basename "$job")" 2>/dev/null || true
        continue
    fi

    dominio="${slug}.${DOMINIO_RAIZ}"
    log "Provisionar UID=${uid} → slug=${slug} tier=${tier} domínio=${dominio}"

    if [ "$DRY_RUN" -eq 1 ]; then
        ok "[dry-run] bash ${SELF_DIR}/novo-cliente.sh ${slug} --tier ${tier}"
        continue
    fi

    if bash "${SELF_DIR}/novo-cliente.sh" "$slug" --tier "$tier" --dominio "$dominio"; then
        porta="$(grep -E '^HOST_PORT=' "$(cliente_env "$slug")" | sed 's/^HOST_PORT=//' | head -n1 | tr -d $'\r"\'')"
        if [ -n "${porta:-}" ] && ! aguardar_dispatch_cliente "$slug" "$porta" 90; then
            err "Cliente ${slug} criado mas dispatch OFF — job em failed."
            mv -f "$job" "${FAILED_DIR}/$(basename "$job").dispatch" 2>/dev/null || true
            continue
        fi
        finished="${DONE_DIR}/${uid}.json"
        cp -a "$job" "$finished"
        printf '{"uid":"%s","slug":"%s","dominio":"%s","tier":"%s","provisionedAt":"%s"}\n' \
            "$uid" "$slug" "$dominio" "$tier" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${DONE_DIR}/${slug}.slug"
        rm -f "$job"
        ok "Cliente ${slug} provisionado para UID ${uid} → https://${dominio}"
    else
        err "Falha ao provisionar ${slug} (UID ${uid}). Job mantido em pending."
        mv -f "$job" "${FAILED_DIR}/$(basename "$job").$(date +%s)" 2>/dev/null || true
    fi
done
