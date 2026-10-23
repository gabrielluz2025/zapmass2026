#!/usr/bin/env bash
# Configuração interativa do Mercado Pago na VPS (não imprime segredos completos).
# Uso: cd /opt/zapmass && bash deployment/mercadopago-configurar.sh
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
  v="${v#Bearer }"
  v="${v//$'\r'/}"
  v="${v//$'\n'/}"
  printf '%s' "$v"
}

DEFAULT_SITE="https://zap-mass.com"
BACK_URL="$(get_env MERCADOPAGO_BACK_URL)"
[ -z "$BACK_URL" ] && BACK_URL="$(get_env PUBLIC_APP_URL)"
[ -z "$BACK_URL" ] && BACK_URL="$DEFAULT_SITE"
BACK_URL="${BACK_URL%/}"

echo "=============================================="
echo " ZapMass — configurar Mercado Pago (produção)"
echo "=============================================="
echo ""
echo "Antes no painel Mercado Pago (login manual):"
echo "  https://www.mercadopago.com.br/developers/panel"
echo "  • Credenciais de produção → Access Token (APP_USR-…, não Public Key)"
echo "  • Webhooks → URL: ${BACK_URL}/api/webhooks/mercadopago"
echo "  • Copie a assinatura secreta do webhook"
echo ""

# --- Access Token ---
EXISTING_TOKEN="$(trim_secret "$(get_env MERCADOPAGO_ACCESS_TOKEN)")"
MP_TOKEN=""
if [ -n "$EXISTING_TOKEN" ]; then
  echo "Token já está no .env (prefixo ${EXISTING_TOKEN:0:14}…, len=${#EXISTING_TOKEN})."
  read -r -p "Substituir o Access Token? [s/N] " REPLACE_TOK
  if [[ "$REPLACE_TOK" =~ ^[sS]$ ]]; then
    read -r -s -p "Cole o APP_USR-… (não aparece na tela): " MP_TOKEN
    echo ""
  else
    MP_TOKEN="$EXISTING_TOKEN"
  fi
else
  read -r -s -p "Cole o Access Token APP_USR-… (não aparece na tela): " MP_TOKEN
  echo ""
fi
MP_TOKEN="$(trim_secret "$MP_TOKEN")"

if [ -z "$MP_TOKEN" ]; then
  echo "ERRO: Access Token vazio. Abortando."
  exit 1
fi
if [[ ! "$MP_TOKEN" =~ ^APP_USR- ]] && [[ ! "$MP_TOKEN" =~ ^TEST- ]]; then
  echo "ERRO: token deve começar com APP_USR- (produção) ou TEST- (sandbox)."
  exit 1
fi

# --- Webhook secret ---
EXISTING_WH="$(trim_secret "$(get_env MERCADOPAGO_WEBHOOK_SECRET)")"
MP_WH=""
if [ -n "$EXISTING_WH" ]; then
  echo "MERCADOPAGO_WEBHOOK_SECRET já definido (len=${#EXISTING_WH})."
  read -r -p "Substituir assinatura do webhook? [s/N] " REPLACE_WH
  if [[ "$REPLACE_WH" =~ ^[sS]$ ]]; then
    read -r -s -p "Cole a assinatura secreta do painel MP: " MP_WH
    echo ""
  else
    MP_WH="$EXISTING_WH"
  fi
else
  echo "Sem MERCADOPAGO_WEBHOOK_SECRET no .env (POST do webhook retorna 503 até configurar)."
  read -r -s -p "Cole a assinatura secreta (Enter para pular): " MP_WH
  echo ""
fi
MP_WH="$(trim_secret "$MP_WH")"

# --- URL pública ---
read -r -p "URL pública do site (back_urls + webhook) [${BACK_URL}]: " BACK_INPUT
if [ -n "$BACK_INPUT" ]; then
  BACK_URL="${BACK_INPUT%/}"
fi
if [[ ! "$BACK_URL" =~ ^https:// ]]; then
  echo "ERRO: use HTTPS (ex.: https://zap-mass.com)."
  exit 1
fi

# --- Preços por tier (opcional) ---
SET_TIERS=""
read -r -p "Gravar preços padrão dos tiers 1–5 no .env? [S/n] " SET_TIERS
TIER_EXPORTS=()
if [[ ! "$SET_TIERS" =~ ^[nN]$ ]]; then
  TIER_EXPORTS=(
    MERCADOPAGO_CHANNEL_TIER_1='149.90'
    MERCADOPAGO_CHANNEL_TIER_2='249.90'
    MERCADOPAGO_CHANNEL_TIER_3='329.90'
    MERCADOPAGO_CHANNEL_TIER_4='399.90'
    MERCADOPAGO_CHANNEL_TIER_5='459.90'
  )
fi

echo ""
echo "==> Gravando .env e secrets/ (sem exibir token)…"
export MERCADOPAGO_ACCESS_TOKEN="$MP_TOKEN"
export MERCADOPAGO_BACK_URL="$BACK_URL"
export PUBLIC_APP_URL="$BACK_URL"
[ -n "$MP_WH" ] && export MERCADOPAGO_WEBHOOK_SECRET="$MP_WH"
for pair in "${TIER_EXPORTS[@]}"; do
  eval "export $pair"
done

bash deployment/vps-env-secrets.sh

echo ""
echo "==> Validando token com api.mercadopago.com…"
export MERCADOPAGO_ACCESS_TOKEN="$MP_TOKEN"
bash deployment/verify-mercadopago-token.sh

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
echo "==> Status local (aguarde API se acabou de fazer deploy)…"
for i in $(seq 1 12); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/billing/mercadopago/status" 2>/dev/null; then
    echo ""
    break
  fi
  [ "$i" -eq 12 ] && echo "AVISO: /api/billing/mercadopago/status ainda indisponível."
  sleep 5
done

echo ""
echo "==> Conferência pública:"
echo "    curl -sS ${BACK_URL}/api/billing/mercadopago/status"
echo "    Esperado: checkoutAvailable:true, issue:null"
echo ""
if [ -z "$MP_WH" ]; then
  echo "LEMBRETE: defina MERCADOPAGO_WEBHOOK_SECRET e redeploy, ou pagamentos não liberam Pro automaticamente."
fi
echo "Pronto."
