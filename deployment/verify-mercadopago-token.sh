#!/usr/bin/env bash
# Valida MERCADOPAGO_ACCESS_TOKEN no host (antes/depois do deploy).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[[:space:]]*(export[[:space:]]+)?MERCADOPAGO_ACCESS_TOKEN=' .env | sed -E 's/^[[:space:]]*export[[:space:]]+//' | head -n 1)
  set +a
fi

TOKEN="${MERCADOPAGO_ACCESS_TOKEN:-}"
TOKEN="${TOKEN#\"}"
TOKEN="${TOKEN%\"}"
TOKEN="${TOKEN#\'}"
TOKEN="${TOKEN%\'}"

if [ -z "$TOKEN" ]; then
  echo "ERRO: MERCADOPAGO_ACCESS_TOKEN vazio no .env"
  exit 1
fi

echo "Token prefixo: ${TOKEN:0:14}… (len=${#TOKEN})"

HTTP=$(curl -sS -o /tmp/zapmass-mp-me.json -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  https://api.mercadopago.com/users/me || echo "000")

if [ "$HTTP" = "200" ]; then
  echo "OK: Mercado Pago aceitou o token (HTTP 200)."
  head -c 200 /tmp/zapmass-mp-me.json
  echo
  exit 0
fi

echo "FALHA: Mercado Pago rejeitou o token (HTTP ${HTTP})."
cat /tmp/zapmass-mp-me.json 2>/dev/null || true
echo
echo "Regenere em https://www.mercadopago.com.br/developers/panel → Credenciais de produção → Access Token (APP_USR-…)"
exit 1
