#!/usr/bin/env bash
# Atualiza Evolution API na VPS (melhor suporte @lid) + WPP_LID_MODE=false.
#
# Tag padrao: evoapicloud/evolution-api:v2.3.7 (ultima estavel, sem licenca).
# Mais recente (RC): evoapicloud/evolution-api:2.4.0-rc2 — exige licenca Evolution Foundation.
# NAO use v2.4.0 — essa tag nao existe no Hub.
#
# Deploy completo (recomendado):
#   cd /opt/zapmass && bash deployment/upgrade-evolution-latest.sh
#
# So .env (legado):
#   cd /opt/zapmass && bash deployment/upgrade-evolution-24.sh
#   bash deployment/manual-pull-deploy.sh
#
# Para testar 2.4 RC (com licenca):
#   EVOLUTION_IMAGE_TARGET=evoapicloud/evolution-api:2.4.0-rc2 bash deployment/upgrade-evolution-latest.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
TARGET_IMAGE="${EVOLUTION_IMAGE_TARGET:-evoapicloud/evolution-api:v2.3.7}"

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
