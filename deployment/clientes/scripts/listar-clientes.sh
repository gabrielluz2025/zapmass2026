#!/usr/bin/env bash
# Lista clientes Plano B e estado operacional.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/listar-clientes.sh

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

if [ ! -d "$CLIENTES_DIR" ] || [ -z "$(ls -A "$CLIENTES_DIR" 2>/dev/null || true)" ]; then
    log "Nenhum cliente provisionado em ${CLIENTES_DIR}."
    exit 0
fi

printf '%-16s %-28s %-6s %-8s %-10s %-8s\n' "SLUG" "DOMINIO" "TIER" "PORTA" "STATUS" "HEALTH"
printf '%-16s %-28s %-6s %-8s %-10s %-8s\n' "----" "-------" "----" "-----" "------" "------"

for dir in "${CLIENTES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue

    env_file="${dir}.env"
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
        code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${porta}/api/health" 2>/dev/null || echo 000)"
        if [ "$code" = "200" ]; then health_col="${C_GREEN}OK${C_END}"; else health_col="${C_RED}${code}${C_END}"; fi
    fi

    printf '%-16s %-28s %-6s %-8s %-10s %-8b\n' "$slug" "${dominio:-?}" "$tier" "${porta:-?}" "$status_col" "$health_col"
done
