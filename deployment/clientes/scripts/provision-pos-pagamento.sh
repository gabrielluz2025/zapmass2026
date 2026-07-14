#!/usr/bin/env bash
# Provisiona cliente após pagamento (Mercado Pago manual ou operador).
#
# USO:
#   sudo bash provision-pos-pagamento.sh <slug> [--dominio dominio.com] [--tier pro] [--sem-ssl]
#
# Fluxo automático (recomendado em produção):
#   Webhook MP → fila /opt/zapmass/provision-queue/pending/ → cron processar-fila-provision.sh

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

if [ $# -lt 1 ]; then
    err "Uso: $0 <slug> [--dominio dominio.com] [--tier starter|pro|business] [--sem-ssl]"
    exit 2
fi

SLUG_RAW="$1"
shift || true

bash "${SELF_DIR}/novo-cliente.sh" "$SLUG_RAW" "$@"

SLUG="$(normalizar_slug "$SLUG_RAW")"
PORTA="$(grep -E '^HOST_PORT=' "$(cliente_env "$slug")" | sed 's/^HOST_PORT=//' | head -n1 | tr -d $'\r"\'')"
DOMINIO="$(grep -E '^PUBLIC_URL=' "$(cliente_env "$slug")" | sed -E 's#^PUBLIC_URL=https?://##' | tr -d $'\r"\'')"

echo
ok "Provisionamento manual concluído."
echo "  URL:     https://${DOMINIO:-${slug}.${ZAPMASS_DOMINIO_RAIZ:-zap-mass.com}}"
echo "  Porta:   ${PORTA:-?}"
echo "  Dispatch: $(cliente_dispatch_ok "${PORTA:-0}" && echo OK || echo OFF)"
echo
echo "Monitorar: bash ${SELF_DIR}/monitor-clientes.sh"
