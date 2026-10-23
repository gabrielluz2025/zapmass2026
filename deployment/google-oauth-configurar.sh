#!/usr/bin/env bash
# Configuração interativa do login Google (OAuth) na VPS (não imprime segredos completos).
# Uso: cd /opt/zapmass && bash deployment/google-oauth-configurar.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$(pwd)" != "/opt/zapmass" ]; then
  echo "AVISO: este script foi pensado para /opt/zapmass na VPS (atual: $(pwd))."
fi

[ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }

get_env() {
  local k="$1"
  grep -E "^[[:space:]]*(export[[:space:]]+)?${k}=" .env 2>/dev/null | tail -1 | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${k}=//" | tr -d '\r"'\' || true
}

trim_secret() {
  local v="$1"
  v="${v#\"}"
  v="${v%\"}"
  v="${v#\'}"
  v="${v%\'}"
  v="${v//$'\r'/}"
  v="${v//$'\n'/}"
  printf '%s' "$v"
}

DEFAULT_SITE="https://zap-mass.com"
PUBLIC_URL="$(get_env PUBLIC_APP_URL)"
[ -z "$PUBLIC_URL" ] && PUBLIC_URL="$DEFAULT_SITE"
PUBLIC_URL="${PUBLIC_URL%/}"
DEFAULT_REDIRECT="${PUBLIC_URL}/api/auth/google/callback"

echo "=============================================="
echo " ZapMass — configurar Login Google (OAuth VPS)"
echo "=============================================="
echo ""
echo "No Google Cloud Console → Credenciais → OAuth 2.0 (Web):"
echo "  • Client ID termina em .apps.googleusercontent.com"
echo "  • Client secret começa com GOCSPX- (NÃO é o mesmo valor do Client ID)"
echo "  • URI de redirecionamento autorizado: ${DEFAULT_REDIRECT}"
echo "  Doc: docs/GOOGLE-LOGIN-VPS.md"
echo ""

# --- Client ID ---
EXISTING_ID="$(trim_secret "$(get_env GOOGLE_OAUTH_CLIENT_ID)")"
G_CLIENT_ID=""
if [ -n "$EXISTING_ID" ]; then
  echo "Client ID já no .env (…${EXISTING_ID: -20})."
  read -r -p "Substituir GOOGLE_OAUTH_CLIENT_ID? [s/N] " REPLACE_ID
  if [[ "$REPLACE_ID" =~ ^[sS]$ ]]; then
    read -r -p "Cole o Client ID (*.apps.googleusercontent.com): " G_CLIENT_ID
  else
    G_CLIENT_ID="$EXISTING_ID"
  fi
else
  read -r -p "Cole o Client ID (*.apps.googleusercontent.com): " G_CLIENT_ID
fi
G_CLIENT_ID="$(trim_secret "$G_CLIENT_ID")"

if [ -z "$G_CLIENT_ID" ]; then
  echo "ERRO: Client ID vazio. Abortando."
  exit 1
fi
if [[ ! "$G_CLIENT_ID" =~ \.apps\.googleusercontent\.com$ ]]; then
  echo "AVISO: Client ID não termina em .apps.googleusercontent.com — confira no GCP."
fi

# --- Client secret ---
EXISTING_SECRET="$(trim_secret "$(get_env GOOGLE_OAUTH_CLIENT_SECRET)")"
G_SECRET=""
if [ -n "$EXISTING_SECRET" ]; then
  echo "GOOGLE_OAUTH_CLIENT_SECRET já definido (len=${#EXISTING_SECRET})."
  read -r -p "Substituir Client secret? [s/N] " REPLACE_SEC
  if [[ "$REPLACE_SEC" =~ ^[sS]$ ]]; then
    read -r -s -p "Cole o Client secret GOCSPX-… (não aparece na tela): " G_SECRET
    echo ""
  else
    G_SECRET="$EXISTING_SECRET"
  fi
else
  read -r -s -p "Cole o Client secret GOCSPX-… (não aparece na tela): " G_SECRET
  echo ""
fi
G_SECRET="$(trim_secret "$G_SECRET")"

if [ -z "$G_SECRET" ]; then
  echo "ERRO: Client secret vazio. Abortando."
  exit 1
fi
if [ "$G_SECRET" = "$G_CLIENT_ID" ]; then
  echo "ERRO: você colou o Client ID no secret — use o GOCSPX-… do painel Google."
  exit 1
fi
if [[ "$G_SECRET" == *".apps.googleusercontent.com"* ]]; then
  echo "ERRO: GOOGLE_OAUTH_CLIENT_SECRET parece ser um Client ID, não o secret GOCSPX-."
  exit 1
fi
if [[ ! "$G_SECRET" =~ ^GOCSPX- ]]; then
  echo "AVISO: secret não começa com GOCSPX- — confira se copiou do campo «Chave secreta do cliente»."
fi

# --- Redirect URI ---
EXISTING_REDIRECT="$(trim_secret "$(get_env GOOGLE_OAUTH_REDIRECT_URI)")"
[ -z "$EXISTING_REDIRECT" ] && EXISTING_REDIRECT="$DEFAULT_REDIRECT"
read -r -p "Redirect URI (callback backend) [${EXISTING_REDIRECT}]: " REDIRECT_INPUT
G_REDIRECT="${REDIRECT_INPUT:-$EXISTING_REDIRECT}"
G_REDIRECT="$(trim_secret "$G_REDIRECT")"

if [[ ! "$G_REDIRECT" =~ ^https:// ]] && [[ ! "$G_REDIRECT" =~ ^http://localhost ]]; then
  echo "ERRO: use HTTPS em produção (ex.: ${DEFAULT_REDIRECT})."
  exit 1
fi

echo ""
echo "==> Gravando .env (ZAPMASS_GOOGLE_LOGIN=1)…"
export ZAPMASS_GOOGLE_LOGIN=1
export GOOGLE_OAUTH_CLIENT_ID="$G_CLIENT_ID"
export GOOGLE_OAUTH_CLIENT_SECRET="$G_SECRET"
export GOOGLE_OAUTH_REDIRECT_URI="$G_REDIRECT"

bash deployment/vps-env-secrets.sh

echo ""
read -r -p "Rodar deploy agora (manual-pull-deploy.sh)? [S/n] " DO_DEPLOY
if [[ ! "$DO_DEPLOY" =~ ^[nN]$ ]]; then
  bash deployment/manual-pull-deploy.sh
else
  echo "Pule deploy — rode depois: bash deployment/manual-pull-deploy.sh"
fi

HOST_PORT="$(get_env HOST_PORT)"
HOST_PORT="${HOST_PORT:-3001}"

echo ""
echo "==> Conferência local (aguarde API após deploy)…"
for i in $(seq 1 12); do
  cfg="$(curl -sf "http://127.0.0.1:${HOST_PORT}/api/auth/config" 2>/dev/null || true)"
  if printf '%s' "$cfg" | grep -q '"googleLoginEnabled"[[:space:]]*:[[:space:]]*true'; then
    echo "  OK: googleLoginEnabled=true"
    break
  fi
  if [ "$i" -eq 12 ]; then
    echo "AVISO: /api/auth/config ainda não retorna googleLoginEnabled:true — veja bash deployment/vps-check-env.sh"
  fi
  sleep 5
done

echo ""
echo "==> Conferência pública:"
echo "    curl -sS ${PUBLIC_URL}/api/auth/config | jq '.googleLoginEnabled'"
echo "    Esperado: true"
echo ""
echo "Pronto."
