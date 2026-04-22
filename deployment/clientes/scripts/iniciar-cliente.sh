#!/usr/bin/env bash
# Liga (ou reinicia) o container de um cliente.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/iniciar-cliente.sh <slug>

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug>"
    exit 2
fi
SLUG="$(normalizar_slug "$SLUG_RAW")"

if ! cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' nao existe."
    exit 1
fi

DIR="$(cliente_dir "$SLUG")"
log "A iniciar zapmass-cli-${SLUG}..."
(cd "$DIR" && docker compose up -d)

# Pequeno healthcheck.
PORTA="$(grep -E '^HOST_PORT=' "${DIR}/.env" | sed 's/^HOST_PORT=//')"
for i in $(seq 1 10); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORTA}/api/health" || echo 000)"
    if [ "$code" = "200" ]; then ok "Cliente ${SLUG} saudavel na porta ${PORTA}."; exit 0; fi
    sleep 2
done
warn "Container subiu mas nao respondeu 200 em /api/health ao fim de 20s. Ver logs:"
echo "  docker compose -f ${DIR}/docker-compose.yml logs --tail=50"
