#!/usr/bin/env bash
# ZapMass — alinha .env + nginx para login Google em app.zap-mass.com (painel) com API/callback no apex.
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
[ -f .env ] || { echo "ERRO: sem .env em $ROOT"; exit 1; }

echo "=============================================="
echo " ZapMass — login Google (app + apex)"
echo "=============================================="
echo ""
echo "Ajusta PUBLIC_APP_URL, ALLOWED_ORIGINS, VITE_API_ORIGIN e sincroniza nginx."
echo "Doc: docs/GOOGLE-LOGIN-VPS.md"
echo ""

API_ORIGIN_DEFAULT="https://zap-mass.com"
APP_URL_DEFAULT="https://app.zap-mass.com"
REDIRECT_DEFAULT="${API_ORIGIN_DEFAULT}/api/auth/google/callback"
ORIGINS_DEFAULT="${APP_URL_DEFAULT},${API_ORIGIN_DEFAULT},https://www.zap-mass.com"

read -r -p "URL do painel (PUBLIC_APP_URL) [${APP_URL_DEFAULT}]: " _pub
_pub="${_pub:-$APP_URL_DEFAULT}"
read -r -p "Origem da API no build (VITE_API_ORIGIN) [${API_ORIGIN_DEFAULT}]: " _vite
_vite="${_vite:-$API_ORIGIN_DEFAULT}"
read -r -p "GOOGLE_OAUTH_REDIRECT_URI [${REDIRECT_DEFAULT}]: " _red
_red="${_red:-$REDIRECT_DEFAULT}"
read -r -p "ALLOWED_ORIGINS [${ORIGINS_DEFAULT}]: " _orig
_orig="${_orig:-$ORIGINS_DEFAULT}"

export ZAPMASS_GOOGLE_LOGIN=1
export PUBLIC_APP_URL="${_pub%/}"
export VITE_API_ORIGIN="${_vite%/}"
export GOOGLE_OAUTH_REDIRECT_URI="${_red}"
export ALLOWED_ORIGINS="${_orig}"

bash deployment/patch-allowed-origins-vps.sh
bash deployment/vps-env-secrets.sh

if [ -f deployment/nginx-zapmass.conf ] && [ -d /etc/nginx/sites-available ]; then
  echo "==> Atualizar nginx (sites-available/zapmass)"
  cp deployment/nginx-zapmass.conf /etc/nginx/sites-available/zapmass
  nginx -t && systemctl reload nginx
fi

echo ""
bash deployment/vps-check-env.sh
echo ""
echo "Próximo passo (rebuild obrigatório — VITE_API_ORIGIN entra no bundle):"
echo "  bash deployment/manual-pull-deploy.sh"
echo ""
echo "Google Cloud → OAuth Web:"
echo "  Origens JS: ${_pub}, ${API_ORIGIN_DEFAULT}, https://www.zap-mass.com"
echo "  Redirect:   ${_red}"
