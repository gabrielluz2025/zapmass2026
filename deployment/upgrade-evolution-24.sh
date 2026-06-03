#!/usr/bin/env bash
# Atualiza Evolution API para >= 2.4 e WPP_LID_MODE=false na VPS (melhor suporte @lid).
# Requer re-scan QR nas instâncias após o pull da nova imagem.
#
# Uso (SSH na VPS):
#   cd /opt/zapmass && sudo bash deployment/upgrade-evolution-24.sh
#
# Depois: bash deployment/manual-pull-deploy.sh  (ou aguardar GitHub Actions)
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
TARGET_IMAGE="${EVOLUTION_IMAGE_TARGET:-evoapicloud/evolution-api:v2.4.0}"

cd "$ROOT"
if [ ! -f "$ENV" ]; then
  echo "Erro: $ENV nao encontrado." >&2
  exit 1
fi

cp -a "$ENV" "${ENV}.bak.evo24.$(date +%Y%m%d%H%M%S)"
echo "==> Evolution 2.4: backup .env criado"

set_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV"; then
    sed -i -E "s|^([[:space:]]*export[[:space:]]+)?${key}=.*|\\1${key}=${value}|" "$ENV"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV"
  fi
}

set_env "EVOLUTION_IMAGE" "$TARGET_IMAGE"
set_env "WPP_LID_MODE" "false"

echo "==> .env: EVOLUTION_IMAGE=${TARGET_IMAGE}"
echo "==> .env: WPP_LID_MODE=false"
echo ""
echo "AVISO: apos o deploy, chips podem precisar de novo QR em Conexoes."
echo "Execute:"
echo "  cd ${ROOT} && bash deployment/manual-pull-deploy.sh"
echo ""
echo "Verifique versao em producao:"
echo "  curl -s https://zap-mass.com/api/health/deep -H \"Authorization: Bearer \$METRICS_TOKEN\" | jq .evolutionImage"
