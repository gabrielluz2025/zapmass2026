#!/usr/bin/env bash
# Diagnóstico do .env e secrets em /opt/zapmass (rodar na VPS).
set -euo pipefail
cd /opt/zapmass
ENV_FILE="${ENV_FILE:-.env}"

ok() { echo "  OK: $*"; }
miss() { echo "  FALTA: $*"; }
warn() { echo "  AVISO: $*"; }

get_env() {
  local k="$1"
  grep -E "^[[:space:]]*(export[[:space:]]+)?${k}=" "$ENV_FILE" 2>/dev/null | tail -1 | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${k}=//" | tr -d '\r"'\' || true
}

echo "==> ZapMass — verificação de ambiente ($(hostname -f 2>/dev/null || hostname))"
echo "==> $(pwd) / $ENV_FILE"
echo ""

if [ ! -f "$ENV_FILE" ]; then
  miss "ficheiro $ENV_FILE — copie: cp .env.example .env"
  exit 1
fi

for k in ALLOWED_ORIGINS PUBLIC_APP_URL HOST_PORT; do
  v="$(get_env "$k")"
  if [ -n "$v" ]; then ok "$k definido"; else miss "$k (ver .env.example)"; fi
done

if [ -f secrets/firebase-admin.json ]; then
  ok "secrets/firebase-admin.json (Firebase Admin / Firestore / trial / billing)"
else
  miss "secrets/firebase-admin.json — Console Firebase → Service accounts → Generate key → chmod 600"
fi

fb="$(get_env FIREBASE_WEB_API_KEY)"
vf="$(get_env VITE_FIREBASE_API_KEY)"
if [ -n "$fb" ] || [ -n "$vf" ]; then
  ok "FIREBASE_WEB_API_KEY ou VITE_FIREBASE_API_KEY (login funcionário)"
else
  miss "FIREBASE_WEB_API_KEY — rode: bash deployment/vps-env-bootstrap.sh"
fi

mp="$(get_env MERCADOPAGO_ACCESS_TOKEN)"
if [ -n "$mp" ]; then
  ok "MERCADOPAGO_ACCESS_TOKEN (len=${#mp})"
  case "$mp" in
    APP_USR-*) ok "token parece produção (APP_USR-…)" ;;
    TEST-*) warn "token de TEST — checkout real usará sandbox" ;;
    *) warn "prefixo do token não reconhecido — confira credenciais MP" ;;
  esac
else
  miss "MERCADOPAGO_ACCESS_TOKEN — Painel MP → Credenciais → APP_USR-..."
fi

mp_wh="$(get_env MERCADOPAGO_WEBHOOK_SECRET)"
if [ -n "$mp_wh" ]; then
  ok "MERCADOPAGO_WEBHOOK_SECRET (assinatura de webhooks)"
else
  warn "MERCADOPAGO_WEBHOOK_SECRET vazio — em produção configure em MP → Webhooks → assinatura"
fi

mp_back="$(get_env MERCADOPAGO_BACK_URL)"
if [ -n "$mp_back" ]; then
  ok "MERCADOPAGO_BACK_URL=$mp_back"
else
  warn "MERCADOPAGO_BACK_URL vazio — use https://zap-mass.com (back_urls + webhook)"
fi

tier1="$(get_env MERCADOPAGO_CHANNEL_TIER_1)"
if [ -n "$tier1" ]; then
  ok "MERCADOPAGO_CHANNEL_TIER_1=$tier1 (checkout por canais)"
else
  warn "MERCADOPAGO_CHANNEL_TIER_1 vazio — servidor usa defaults de shared/channelTierPricing"
fi

rs="$(get_env RESEND_API_KEY)"
if [ -n "$rs" ]; then
  ok "RESEND_API_KEY"
else
  miss "RESEND_API_KEY — resend.com → API Keys"
fi

for k in EMAIL_FROM PUBLIC_APP_URL; do
  v="$(get_env "$k")"
  if [ -n "$rs" ] && [ -z "$v" ] && [ "$k" = "EMAIL_FROM" ]; then
    warn "$k vazio (emails Resend podem falhar)"
  fi
done

auth="$(get_env ZAPMASS_AUTH_PROVIDER)"
if [ "$auth" = "vps" ]; then
  ok "ZAPMASS_AUTH_PROVIDER=vps (sem Firebase)"
elif [ "$auth" = "dual" ]; then
  ok "ZAPMASS_AUTH_PROVIDER=dual (Firebase + VPS)"
else
  echo "  INFO: auth Firebase (legado). Ativar VPS: bash deployment/vps-pure-no-firebase.sh"
fi
if [ "$auth" = "vps" ] || [ "$auth" = "dual" ]; then
  for k in ZAPMASS_JWT_SECRET ZAPMASS_DATABASE_URL ZAPMASS_DATA_PROVIDER; do
    v="$(get_env "$k")"
    if [ -n "$v" ]; then ok "$k"; else miss "$k"; fi
  done
fi

echo ""
echo "==> Health local:"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${HOST_PORT:-3001}/api/health 2>/dev/null || echo 000)"
ver="$(curl -sf http://127.0.0.1:${HOST_PORT:-3001}/api/version 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
echo "  /api/health → HTTP ${code}  versão=${ver:-?}  git=$(git rev-parse --short HEAD 2>/dev/null || echo ?)"
echo ""
echo "Depois de corrigir secrets: bash deployment/manual-pull-deploy.sh"
