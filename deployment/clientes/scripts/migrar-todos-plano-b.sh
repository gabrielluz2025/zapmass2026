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

for dir in "${CLIENTES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    [ -f "${dir}/docker-compose.yml" ] || continue
    log "Migrando ${slug}..."
    bash "${SELF_DIR}/migrar-cliente-plano-b.sh" "$slug" || warn "Falha: ${slug}"
done

ok "Migração em massa concluída."
bash "${SELF_DIR}/monitor-clientes.sh"
