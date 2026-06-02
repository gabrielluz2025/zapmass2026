#!/usr/bin/env bash
# Grava tokens secretos no .env (passar por variáveis de ambiente — não commitar).
# Exemplo na VPS:
#   MERCADOPAGO_ACCESS_TOKEN='APP_USR-...' \
#   MERCADOPAGO_WEBHOOK_SECRET='...' \
#   RESEND_API_KEY='re_...' \
#   EMAIL_FROM='ZapMass <no-reply@zap-mass.com>' \
#   bash deployment/vps-env-secrets.sh
set -euo pipefail
cd /opt/zapmass
[ -f .env ] || cp .env.example .env

upsert_env() {
  local key="$1" val="$2"
  [ -n "$val" ] || return 0
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" .env 2>/dev/null; then
    sed -i "s|^[[:space:]]*\\(export[[:space:]]\\+\\)\\?${key}=.*|${key}=${val}|" .env
    echo "==> atualizado ${key}"
  else
    printf '%s=%s\n' "$key" "$val" >> .env
    echo "==> adicionado ${key}"
  fi
}

upsert_env MERCADOPAGO_ACCESS_TOKEN "${MERCADOPAGO_ACCESS_TOKEN:-}"
upsert_env MERCADOPAGO_WEBHOOK_SECRET "${MERCADOPAGO_WEBHOOK_SECRET:-}"
upsert_env MERCADOPAGO_PRICE_MONTHLY "${MERCADOPAGO_PRICE_MONTHLY:-}"
upsert_env MERCADOPAGO_PRICE_ANNUAL "${MERCADOPAGO_PRICE_ANNUAL:-}"
upsert_env RESEND_API_KEY "${RESEND_API_KEY:-}"
upsert_env EMAIL_FROM "${EMAIL_FROM:-}"
upsert_env EMAIL_REPLY_TO "${EMAIL_REPLY_TO:-}"
upsert_env SUGGESTION_NOTIFY_EMAIL "${SUGGESTION_NOTIFY_EMAIL:-}"
upsert_env NEW_CLIENT_NOTIFY_EMAIL "${NEW_CLIENT_NOTIFY_EMAIL:-}"

if [ -n "${MERCADOPAGO_ACCESS_TOKEN:-}" ]; then
  mkdir -p secrets
  printf '%s\n' "$MERCADOPAGO_ACCESS_TOKEN" > secrets/mercadopago_access_token
  chmod 600 secrets/mercadopago_access_token
fi

echo ""
bash deployment/vps-check-env.sh
echo ""
echo "Se tudo OK nos itens críticos: bash deployment/manual-pull-deploy.sh"
