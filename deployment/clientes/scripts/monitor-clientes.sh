#!/usr/bin/env bash
# Monitoramento Plano B — health, RAM/CPU por cliente, alertas simples.
#
# USO:
#   sudo bash monitor-clientes.sh
#   sudo bash monitor-clientes.sh --json

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

JSON=0
while [ $# -gt 0 ]; do
    case "$1" in
        --json) JSON=1; shift;;
        *) shift;;
    esac
done

if [ ! -d "$CLIENTES_DIR" ] || [ -z "$(ls -A "$CLIENTES_DIR" 2>/dev/null || true)" ]; then
    log "Nenhum cliente provisionado."
    exit 0
fi

echo "=== ZapMass Plano B — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Load: $(uptime | sed 's/.*load average: //')"
free -h 2>/dev/null | grep -E '^Mem:' || true
echo

printf '%-16s %-8s %-8s %-10s %-12s %-10s\n' "SLUG" "TIER" "PORT" "HEALTH" "RAM" "CPU%"
printf '%-16s %-8s %-8s %-10s %-12s %-10s\n' "----" "----" "----" "------" "---" "----"

for dir in "${CLIENTES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    env_file="${dir}.env"
    [ -f "$env_file" ] || continue

    porta="$(grep -E '^HOST_PORT=' "$env_file" | sed 's/^HOST_PORT=//' | head -n1)"
    tier="$(grep -E '^TIER=' "$env_file" | sed 's/^TIER=//' | head -n1)"
    tier="${tier:-starter}"
    cname="zapmass-cli-${slug}"

    if ! docker ps --format '{{.Names}}' | grep -qx "$cname"; then
        printf '%-16s %-8s %-8s %-10s %-12s %-10s\n' "$slug" "$tier" "${porta:-?}" "PARADO" "-" "-"
        continue
    fi

    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${porta}/api/health" 2>/dev/null || echo 000)"
    health="$code"
    [ "$code" = "200" ] && health="OK"

    stats="$(docker stats --no-stream --format '{{.MemUsage}}\t{{.CPUPerc}}' "$cname" 2>/dev/null || echo '-\t-')"
    mem="$(printf '%s' "$stats" | cut -f1)"
    cpu="$(printf '%s' "$stats" | cut -f2)"

    printf '%-16s %-8s %-8s %-10s %-12s %-10s\n' "$slug" "$tier" "${porta:-?}" "$health" "$mem" "$cpu"
done

echo
echo "Disco backups: $(du -sh "${ZAPMASS_ROOT}/backups" 2>/dev/null | awk '{print $1}' || echo '?')"
echo "Comando: bash ${SELF_DIR}/listar-clientes.sh"
