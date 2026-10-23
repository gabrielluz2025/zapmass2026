#!/usr/bin/env bash
# ZapMass — login Google no painel app.* (same-origin: callback + API no mesmo host do SPA).
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
[ -f .env ] || { echo "ERRO: sem .env em $ROOT"; exit 1; }

_noninteractive() {
  case "${NON_INTERACTIVE:-}${ZAPMASS_GOOGLE_APP_CONFIGURE:-}" in
    *1*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "=============================================="
echo " ZapMass — login Google (painel app)"
echo "=============================================="
echo ""
echo "Preferência: GOOGLE_OAUTH_REDIRECT_URI no host do painel e VITE_API_ORIGIN vazio (same-origin)."
echo "Cross-host (app → apex): export ZAPMASS_CROSS_HOST_API=1 e VITE_API_ORIGIN=https://zap-mass.com"
echo "Doc: docs/GOOGLE-LOGIN-VPS.md"
echo ""

APP_URL_DEFAULT="https://app.zap-mass.com"
API_ORIGIN_DEFAULT="https://zap-mass.com"
REDIRECT_DEFAULT="${APP_URL_DEFAULT}/api/auth/google/callback"
ORIGINS_DEFAULT="${APP_URL_DEFAULT},${API_ORIGIN_DEFAULT},https://www.zap-mass.com"

if _noninteractive; then
  _pub="${PUBLIC_APP_URL:-$APP_URL_DEFAULT}"
  _pub="${_pub%/}"
  _red="${GOOGLE_OAUTH_REDIRECT_URI:-${_pub}/api/auth/google/callback}"
  _orig="${ALLOWED_ORIGINS:-$ORIGINS_DEFAULT}"
  _vite="${VITE_API_ORIGIN:-}"
  echo "Modo não interativo: PUBLIC_APP_URL=$_pub"
  echo "  GOOGLE_OAUTH_REDIRECT_URI=$_red"
  echo "  VITE_API_ORIGIN=${_vite:-<vazio — same-origin>}"
else
  read -r -p "URL do painel (PUBLIC_APP_URL) [${APP_URL_DEFAULT}]: " _pub
  _pub="${_pub:-$APP_URL_DEFAULT}"
  _pub="${_pub%/}"
  read -r -p "GOOGLE_OAUTH_REDIRECT_URI [${_pub}/api/auth/google/callback]: " _red
  _red="${_red:-${_pub}/api/auth/google/callback}"
  read -r -p "Origem da API no build (VITE_API_ORIGIN) [vazio = same-origin]: " _vite
  _vite="${_vite:-}"
  read -r -p "ALLOWED_ORIGINS [${ORIGINS_DEFAULT}]: " _orig
  _orig="${_orig:-$ORIGINS_DEFAULT}"
fi

export ZAPMASS_GOOGLE_LOGIN=1
export PUBLIC_APP_URL="${_pub}"
export GOOGLE_OAUTH_REDIRECT_URI="${_red}"
export ALLOWED_ORIGINS="${_orig}"

if [ -n "${_vite}" ]; then
  export VITE_API_ORIGIN="${_vite%/}"
  unset CLEAR_VITE_API_ORIGIN || true
else
  export VITE_API_ORIGIN=""
  export CLEAR_VITE_API_ORIGIN=1
fi

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
echo "Google Cloud → OAuth Web (obrigatório se mudou o redirect):"
echo "  Origens JS: ${_pub}, ${API_ORIGIN_DEFAULT}, https://www.zap-mass.com"
echo "  Redirect:   ${_red}"
echo ""
echo "Próximo passo (rebuild se VITE_API_ORIGIN mudou):"
echo "  bash deployment/manual-pull-deploy.sh"
