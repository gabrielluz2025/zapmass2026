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

_auth_mode="$(get_env ZAPMASS_AUTH_PROVIDER)"
_data_mode="$(get_env ZAPMASS_DATA_PROVIDER)"
if [ "$_auth_mode" = "vps" ] && [ "$_data_mode" = "vps" ]; then
  echo "  INFO: modo VPS puro — Firebase (firebase-admin.json / FIREBASE_WEB_API_KEY) não é necessário"
else
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
fi

_enf="$(get_env SUBSCRIPTION_ENFORCE | tr '[:upper:]' '[:lower:]')"
case "$_enf" in
  0|false|off|no) miss "SUBSCRIPTION_ENFORCE=$_enf — em produção o acesso fica LIBERADO sem assinatura. Remova ou use 1" ;;
  *) ok "SUBSCRIPTION_ENFORCE ativo (padrão em produção)" ;;
esac
_venf="$(get_env VITE_ENFORCE_SUBSCRIPTION | tr '[:upper:]' '[:lower:]')"
case "$_venf" in
  0|false|off|no) miss "VITE_ENFORCE_SUBSCRIPTION=$_venf — front sem gate de assinatura (precisa rebuild da imagem)" ;;
esac

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
  case "$mp_back" in
    *localhost*|*127.0.0.1*|http://*) miss "MERCADOPAGO_BACK_URL=$mp_back — precisa ser https público (checkout falha em produção)" ;;
    *) ok "MERCADOPAGO_BACK_URL=$mp_back" ;;
  esac
else
  warn "MERCADOPAGO_BACK_URL vazio — use https://zap-mass.com (back_urls + webhook)"
fi

_google_login="$(get_env ZAPMASS_GOOGLE_LOGIN | tr '[:upper:]' '[:lower:]')"
case "$_google_login" in
  1|true|yes|on)
    ok "ZAPMASS_GOOGLE_LOGIN ativo"
    g_id="$(get_env GOOGLE_OAUTH_CLIENT_ID)"
    g_sec="$(get_env GOOGLE_OAUTH_CLIENT_SECRET)"
    g_red="$(get_env GOOGLE_OAUTH_REDIRECT_URI)"
    if [ -n "$g_id" ]; then
      case "$g_id" in
        *apps.googleusercontent.com*) ok "GOOGLE_OAUTH_CLIENT_ID (formato Google)" ;;
        *) warn "GOOGLE_OAUTH_CLIENT_ID não parece Client ID Google (*.apps.googleusercontent.com)" ;;
      esac
    else
      miss "GOOGLE_OAUTH_CLIENT_ID — GCP → Credenciais → OAuth 2.0"
    fi
    if [ -n "$g_sec" ]; then
      if [ "$g_sec" = "$g_id" ]; then
        miss "GOOGLE_OAUTH_CLIENT_SECRET igual ao CLIENT_ID — use o secret GOCSPX- do GCP, não o Client ID"
      elif [[ "$g_sec" == *".apps.googleusercontent.com"* ]]; then
        miss "GOOGLE_OAUTH_CLIENT_SECRET parece Client ID — copie «Chave secreta do cliente» (GOCSPX-…)"
      else
        ok "GOOGLE_OAUTH_CLIENT_SECRET (len=${#g_sec})"
        case "$g_sec" in
          GOCSPX-*) ok "secret com prefixo GOCSPX- (esperado)" ;;
          *) warn "secret sem prefixo GOCSPX- — confira se não colou o Client ID" ;;
        esac
      fi
    else
      miss "GOOGLE_OAUTH_CLIENT_SECRET — GCP → Chave secreta do cliente (GOCSPX-…)"
    fi
    if [ -n "$g_red" ]; then
      case "$g_red" in
        *localhost*|http://127.0.0.1*) ok "GOOGLE_OAUTH_REDIRECT_URI=$g_red (dev)" ;;
        http://*) miss "GOOGLE_OAUTH_REDIRECT_URI=$g_red — produção exige https" ;;
        *) ok "GOOGLE_OAUTH_REDIRECT_URI=$g_red" ;;
      esac
    else
      miss "GOOGLE_OAUTH_REDIRECT_URI — ex.: https://zap-mass.com/api/auth/google/callback"
    fi
    _allowed="$(get_env ALLOWED_ORIGINS)"
    _pub="$(get_env PUBLIC_APP_URL)"
    if [ -n "$_pub" ]; then
      case "$_pub" in
        *app.zap-mass.com*)
          if [ -n "$_allowed" ] && [[ "$_allowed" == *"app.zap-mass.com"* ]]; then
            ok "ALLOWED_ORIGINS inclui app.zap-mass.com"
          else
            warn "PUBLIC_APP_URL=$_pub mas ALLOWED_ORIGINS não lista https://app.zap-mass.com — login Google pode falhar no refresh"
          fi
          _vite="$(get_env VITE_API_ORIGIN)"
          _red="$(get_env GOOGLE_OAUTH_REDIRECT_URI)"
          _red_host=""
          _pub_host=""
          case "$_red" in
            http://*|https://*) _red_host="$(echo "$_red" | sed -E 's|^https?://([^/:]+).*|\1|' | tr '[:upper:]' '[:lower:]')" ;;
          esac
          case "$_pub" in
            http://*|https://*) _pub_host="$(echo "$_pub" | sed -E 's|^https?://([^/:]+).*|\1|' | tr '[:upper:]' '[:lower:]')" ;;
          esac
          if [ -n "$_pub_host" ] && [ "$_pub_host" = "$_red_host" ] && [ -z "$_vite" ]; then
            ok "Login Google same-origin (callback em $_pub_host, sem VITE_API_ORIGIN)"
          elif [ -n "$_vite" ]; then
            warn "VITE_API_ORIGIN=$_vite — refresh cross-host; prefira callback no app e VITE vazio (bash deployment/fix-google-login-app.sh)"
          elif [ -n "$_red" ] && [ "$_pub_host" != "$_red_host" ]; then
            warn "Callback OAuth ($_red_host) ≠ painel ($_pub_host) — defina ZAPMASS_CROSS_HOST_API=1 + VITE_API_ORIGIN ou mova callback para app"
          fi
          ;;
      esac
    fi
    if [ -n "$_allowed" ]; then
      ok "ALLOWED_ORIGINS definido (CORS + returnTo OAuth)"
    else
      miss "ALLOWED_ORIGINS — ex.: https://app.zap-mass.com,https://zap-mass.com,https://www.zap-mass.com"
    fi
    ;;
  *)
    echo "  INFO: login Google desligado (ZAPMASS_GOOGLE_LOGIN≠1). Ativar: bash deployment/google-oauth-configurar.sh"
    ;;
esac

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
_h="$(curl -sf --max-time 12 http://127.0.0.1:${HOST_PORT:-3001}/api/health 2>/dev/null || true)"
for f in mercadopagoConfigured mercadopagoCheckoutAvailable mercadopagoWebhookSecretConfigured subscriptionEnforced emailConfigured; do
  val="$(printf '%s' "$_h" | sed -n "s/.*\"$f\"[[:space:]]*:[[:space:]]*\([a-z]*\).*/\1/p" | head -1)"
  if [ "$val" = "true" ]; then ok "health.$f=true"; else warn "health.$f=${val:-?} (esperado true para vender)"; fi
done
echo ""
echo "Depois de corrigir secrets: bash deployment/manual-pull-deploy.sh"
