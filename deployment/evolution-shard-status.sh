#!/usr/bin/env bash
# Status das instâncias Evolution (shards) e distribuição de clientes Plano B.
#
# USO:
#   bash deployment/evolution-shard-status.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZAPMASS_ROOT="${ZAPMASS_ROOT:-$ROOT}"
# shellcheck source=/dev/null
. "${ZAPMASS_ROOT}/deployment/clientes/scripts/_comum.sh"

KEY="$(ler_env_principal EVOLUTION_API_KEY)"
KEY="${KEY:-zapmass-secure-key-2026}"

echo "=== Evolution shards — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "EVOLUTION_SHARD_ENABLED: $(evolution_shard_habilitado && echo sim || echo não)"
echo

printf '%-14s %-10s %-12s %-12s %-10s\n' "SHARD" "CONTAINER" "INSTÂNCIAS" "CLIENTES" "STATUS"
printf '%-14s %-10s %-12s %-12s %-10s\n' "-----" "---------" "----------" "--------" "------"

for svc in evolution evolution-2; do
    url="http://${svc}:8080"
    [ "$svc" = "evolution" ] && url="http://evolution:8080"
    container="$(evolution_container_por_servico "$svc")"
    status="PARADO"
    [ -n "$container" ] && status="UP"
    count="$(_contar_instancias_evolution_api "$url" "$KEY" "$svc")"
    clients="$(_contar_clientes_por_shard "$url")"
    printf '%-14s %-10s %-12s %-12s %-10s\n' "$svc" "${container:-—}" "$count" "$clients" "$status"
done

echo
if [ -d "$CLIENTES_DIR" ]; then
    echo "Clientes por shard:"
    for dir in "${CLIENTES_DIR}"/*/; do
        [ -d "$dir" ] || continue
        slug="$(basename "$dir")"
        [[ "$slug" == *removido* ]] && continue
        evol="$(ler_evolution_shard_cliente "$slug")"
        echo "  ${slug} → ${evol}"
    done
fi
