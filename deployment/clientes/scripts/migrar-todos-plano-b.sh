#!/usr/bin/env bash
# Migra TODOS os clientes existentes para Plano B.
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

bash "${SELF_DIR}/setup-nginx-rate-limit.sh" || true
bash "${SELF_DIR}/setup-backup-cron.sh" || true

if [ ! -d "$CLIENTES_DIR" ]; then
    log "Nenhum cliente."
    exit 0
fi

shopt -s nullglob
dirs=("${CLIENTES_DIR}"/*/)
shopt -u nullglob

if [ "${#dirs[@]}" -eq 0 ]; then
    warn "Pasta ${CLIENTES_DIR} existe mas não há subpastas de clientes."
    warn "Containers zapmass-cli-* órfãos: $(docker ps -a --filter 'name=zapmass-cli-' --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')"
    exit 0
fi

n=0
for dir in "${dirs[@]}"; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    [ -f "${dir}/docker-compose.yml" ] || continue
    log "Migrando ${slug}..."
    bash "${SELF_DIR}/migrar-cliente-plano-b.sh" "$slug" || warn "Falha: ${slug}"
    n=$((n + 1))
done

if [ "$n" -eq 0 ]; then
    warn "Nenhum cliente migrado — verifique ls ${CLIENTES_DIR}/"
else
    ok "${n} cliente(s) migrado(s)."
fi
bash "${SELF_DIR}/monitor-clientes.sh"
