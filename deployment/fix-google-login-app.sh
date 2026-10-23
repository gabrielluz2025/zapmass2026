#!/usr/bin/env bash
# Corrige login Google em app.zap-mass.com (same-origin + redirect no subdomínio app).
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
NON_INTERACTIVE=1 \
ZAPMASS_GOOGLE_APP_CONFIGURE=1 \
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://app.zap-mass.com}" \
GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-https://app.zap-mass.com/api/auth/google/callback}" \
VITE_API_ORIGIN="" \
CLEAR_VITE_API_ORIGIN=1 \
bash deployment/google-app-login-configurar.sh
bash deployment/manual-pull-deploy.sh
