#!/usr/bin/env bash
# Backup de todos os clientes ativos (chamado pelo cron).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

log "Backup Plano B — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ ! -d "$CLIENTES_DIR" ]; then
    log "Nenhum cliente em ${CLIENTES_DIR}."
    exit 0
fi

for dir in "${CLIENTES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    [ -f "${dir}/docker-compose.yml" ] || continue
    bash "${SELF_DIR}/backup-cliente.sh" "$slug" || warn "Backup falhou: ${slug}"
done

# Rotação: manter 14 dias
find "${ZAPMASS_ROOT}/backups" -name '*.tar.gz' -mtime +14 -delete 2>/dev/null || true

ok "Backup concluído."
