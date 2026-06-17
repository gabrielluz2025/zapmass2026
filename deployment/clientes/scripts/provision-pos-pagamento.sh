#!/usr/bin/env bash
# Wrapper pós-venda: provisiona cliente após pagamento (Mercado Pago / manual).
#
# USO:
#   sudo bash provision-pos-pagamento.sh <slug> [--dominio dominio.com] [--tier pro] [--sem-ssl]
#
# Exemplo webhook / operador:
#   sudo bash provision-pos-pagamento.sh empresa-x --tier pro

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "${SELF_DIR}/novo-cliente.sh" "$@"
