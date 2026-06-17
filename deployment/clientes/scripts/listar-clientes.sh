#!/usr/bin/env bash
# Lista clientes Plano B e estado operacional.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/listar-clientes.sh

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

if [ ! -d "$CLIENTES_DIR" ]; then
    log "Nenhum cliente provisionado em ${CLIENTES_DIR}."
    exit 0
fi

shopt -s nullglob
dirs=("${CLIENTES_DIR}"/*/)
shopt -u nullglob

if [ "${#dirs[@]}" -eq 0 ]; then
    log "Nenhuma subpasta de cliente em ${CLIENTES_DIR}."
    orphans="$(docker ps -a --filter 'name=zapmass-cli-' --format '{{.Names}}' 2>/dev/null || true)"
    if [ -n "$orphans" ]; then
        warn "Containers órfãos (sem pasta):"
        echo "$orphans" | sed 's/^/  /'
    fi
    exit 0
fi

printf '%-16s %-28s %-6s %-8s %-10s %-8s\n' "SLUG" "DOMINIO" "TIER" "PORTA" "STATUS" "HEALTH"
printf '%-16s %-28s %-6s %-8s %-10s %-8s\n' "----" "-------" "----" "-----" "------" "------"

for dir in "${dirs[@]}"; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue

    env_file="$(cliente_env "$slug")"
    if [ ! -f "$env_file" ]; then
        printf '%-16s %-28s %-6s %-8s %-10s %-8s\n' "$slug" "(sem .env)" "-" "-" "-" "-"
        continue
    fi

    dominio="$(grep -E '^PUBLIC_URL=' "$env_file" | sed 's#^PUBLIC_URL=https\?://##' | head -n1)"
    porta="$(grep -E '^HOST_PORT=' "$env_file" | sed 's/^HOST_PORT=//' | head -n1)"
    tier="$(grep -E '^TIER=' "$env_file" | sed 's/^TIER=//' | head -n1)"
    tier="${tier:-?}"
    container_name="zapmass-cli-${slug}"

    container_status="$(docker ps --filter "name=^${container_name}$" --format '{{.Status}}' 2>/dev/null || echo '')"
    if [ -z "$container_status" ]; then
        status_col="parado"
        health_col="-"
    else
        status_col="ativo"
        code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${porta}/api/health" 2>/dev/null || true)"
        code="${code:-000}"
        if [ "$code" = "200" ]; then health_col="${C_GREEN}OK${C_END}"; else health_col="${C_RED}${code}${C_END}"; fi
    fi

    printf '%-16s %-28s %-6s %-8s %-10s %-8b\n' "$slug" "${dominio:-?}" "$tier" "${porta:-?}" "$status_col" "$health_col"
done
