#!/usr/bin/env bash
# Preenche no .env da VPS o que é público / não-secreto (origens, Firebase Web API Key do projeto zapflow25).
# Mercado Pago e Resend continuam a ser colados por você — ver deployment/vps-env-secrets.sh
set -euo pipefail
cd /opt/zapmass
[ -f .env ] || cp .env.example .env
mkdir -p secrets
chmod 700 secrets 2>/dev/null || true

# Mesma Web API Key embutida no front (src/services/firebase.ts) — já pública no bundle.
ZAPMASS_FIREBASE_WEB_API_KEY="${ZAPMASS_FIREBASE_WEB_API_KEY:-AIzaSyAa-a8MMECStZgKxxELeLSJT7JpJOKMJZw}"

set_kv() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" .env 2>/dev/null; then
    return 0
  fi
  printf '%s=%s\n' "$key" "$val" >> .env
  echo "==> adicionado ${key}"
}

# Domínio de produção (ajuste se usar só IP)
set_kv ALLOWED_ORIGINS "https://zap-mass.com,https://www.zap-mass.com,https://zapflow25.web.app"
set_kv PUBLIC_APP_URL "https://zap-mass.com"
set_kv MERCADOPAGO_BACK_URL "https://zap-mass.com"
set_kv HOST_PORT "3001"
set_kv FIREBASE_WEB_API_KEY "$ZAPMASS_FIREBASE_WEB_API_KEY"
set_kv VITE_FIREBASE_API_KEY "$ZAPMASS_FIREBASE_WEB_API_KEY"
set_kv TRUST_PROXY "1"
set_kv TRUST_PROXY_HOPS "1"

if [ ! -f secrets/firebase-admin.json ]; then
  echo ""
  echo "==> PRÓXIMO PASSO OBRIGATÓRIO (Firebase Admin):"
  echo "    1. Firebase Console → zapflow25 → Project settings → Service accounts"
  echo "    2. Generate new private key → guardar como:"
  echo "       /opt/zapmass/secrets/firebase-admin.json"
  echo "    3. chmod 600 secrets/firebase-admin.json"
  echo ""
fi

echo ""
echo "==> Mercado Pago + Resend (secrets — só você tem os tokens):"
echo "    MERCADOPAGO_ACCESS_TOKEN=APP_USR-... RESEND_API_KEY=re_... \\"
echo "      bash deployment/vps-env-secrets.sh"
echo ""
bash deployment/vps-check-env.sh
