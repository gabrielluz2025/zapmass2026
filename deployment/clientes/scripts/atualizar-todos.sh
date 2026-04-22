#!/usr/bin/env bash
# Reconstroi a imagem zapmass-zapmass:latest a partir do codigo em /opt/zapmass
# e reinicia TODOS os containers (instancia principal + cada cliente).
#
# Util quando fazes deploy de uma nova versao do ZapMass e queres que TODOS
# os clientes apanhem essa versao.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/atualizar-todos.sh

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

log "A reconstruir imagem zapmass-zapmass:latest..."
(cd "$ZAPMASS_ROOT" && docker compose build)

log "A reiniciar instancia principal (se existir)..."
if [ -f "${ZAPMASS_ROOT}/docker-compose.yml" ]; then
    (cd "$ZAPMASS_ROOT" && docker compose up -d)
fi

if [ -d "$CLIENTES_DIR" ]; then
    for dir in "${CLIENTES_DIR}"/*/; do
        [ -d "$dir" ] || continue
        slug="$(basename "$dir")"
        [[ "$slug" == *removido* ]] && continue
        [ -f "${dir}/docker-compose.yml" ] || continue

        log "A atualizar cliente ${slug}..."
        (cd "$dir" && docker compose up -d)
    done
fi

log "A limpar imagens antigas..."
docker image prune -f >/dev/null || true

ok "Todos os containers foram atualizados para a imagem mais recente."
bash "${SELF_DIR}/listar-clientes.sh" || true
