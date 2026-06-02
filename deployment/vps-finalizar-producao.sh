#!/usr/bin/env bash
# Um comando na VPS para: atualizar código, .env base, deploy e testes.
# Uso: cd /opt/zapmass && bash deployment/vps-finalizar-producao.sh
#
# O que NÃO dá para automatizar daqui: criar webhook no painel Mercado Pago (precisa do seu login).
set -euo pipefail
cd /opt/zapmass

echo "=============================================="
echo " ZapMass — finalizar produção na VPS"
echo "=============================================="

chmod +x deployment/*.sh 2>/dev/null || true

echo ""
echo "==> 1/5 Atualizar código (main = GitHub)"
bash deployment/ensure-git-main.sh

echo ""
echo "==> 2/5 .env público (origens, Firebase Web Key, URLs)"
bash deployment/vps-env-bootstrap.sh

# Preços padrão se ainda não existirem
set_kv() {
  local k="$1" v="$2"
  grep -qE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env 2>/dev/null && return 0
  echo "${k}=${v}" >> .env
  echo "    + ${k}"
}
set_kv MERCADOPAGO_PRICE_MONTHLY "199.90"
set_kv MERCADOPAGO_PRICE_ANNUAL "1799.00"

get_env() {
  grep -E "^[[:space:]]*(export[[:space:]]+)?${1}=" .env 2>/dev/null | tail -1 | sed -E "s/^[[:space:]]*(export[[:space:]]+)?[^=]+=//" | tr -d '\r"'\' || true
}

MP_URL="$(get_env MERCADOPAGO_BACK_URL)"
[ -z "$MP_URL" ] && MP_URL="$(get_env PUBLIC_APP_URL)"
[ -z "$MP_URL" ] && MP_URL="https://zap-mass.com"
MP_URL="${MP_URL%/}"

echo ""
echo "==> 3/5 Mercado Pago (token já no .env?)"
if grep -qE '^[[:space:]]*(export[[:space:]]+)?MERCADOPAGO_ACCESS_TOKEN=' .env 2>/dev/null; then
  echo "    Token já está no .env."
else
  echo ""
  echo "    Cole o Access Token (APP_USR-... longo) e Enter:"
  read -r MP_TOKEN
  if [ -n "$MP_TOKEN" ]; then
    MERCADOPAGO_ACCESS_TOKEN="$MP_TOKEN" bash deployment/vps-env-secrets.sh
  fi
fi

echo ""
echo "==> 4/5 Deploy Docker"
bash deployment/manual-pull-deploy.sh

echo ""
echo "==> 5/5 Testes automáticos"
echo "    Health local:"
curl -sf "http://127.0.0.1:${HOST_PORT:-3001}/api/health" | head -c 200 || echo " FALHOU"
echo ""
echo "    Webhook local (GET deve responder ok):"
curl -sf "http://127.0.0.1:${HOST_PORT:-3001}/api/webhooks/mercadopago" || echo " FALHOU"
echo ""
echo "    Site público (${MP_URL}):"
if curl -sf "${MP_URL}/api/health" >/dev/null; then
  echo "    OK: ${MP_URL}/api/health"
else
  echo "    AVISO: não respondeu em ${MP_URL} — confira DNS/nginx apontando para esta VPS."
fi
if curl -sf "${MP_URL}/api/webhooks/mercadopago" >/dev/null; then
  echo "    OK: ${MP_URL}/api/webhooks/mercadopago"
else
  echo "    AVISO: webhook público inacessível — configure nginx/SSL."
fi

WH_SECRET="$(get_env MERCADOPAGO_WEBHOOK_SECRET)"
echo ""
if [ -n "$WH_SECRET" ]; then
  echo "==> MERCADOPAGO_WEBHOOK_SECRET já definido no .env."
else
  echo "=============================================="
  echo " ÚNICO PASSO MANUAL (painel Mercado Pago)"
  echo "=============================================="
  echo ""
  echo " 1. Abra: https://www.mercadopago.com.br/developers/panel/app"
  echo " 2. Sua aplicação → Webhooks → Configurar notificações"
  echo " 3. URL de produção:"
  echo "      ${MP_URL}/api/webhooks/mercadopago"
  echo " 4. Eventos: marque pelo menos «Pagamentos» (payment)"
  echo " 5. Copie a «Assinatura secreta» que o MP mostrar"
  echo ""
  echo " Depois cole na VPS:"
  echo "   MERCADOPAGO_WEBHOOK_SECRET='cole_aqui' bash deployment/vps-env-secrets.sh"
  echo "   bash deployment/manual-pull-deploy.sh"
  echo ""
  echo " (Alternativa temporária, menos segura:)"
  echo "   MERCADOPAGO_WEBHOOK_ALLOW_UNSIGNED=1 bash deployment/vps-env-secrets.sh"
  echo "   bash deployment/manual-pull-deploy.sh"
fi

echo ""
bash deployment/vps-check-env.sh
echo ""
echo "Pronto. Teste no navegador: ${MP_URL}"
