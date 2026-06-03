#!/usr/bin/env bash
# Corrige .env quando EVOLUTION_IMAGE aponta para tag inexistente (ex. v2.4.0).
# Uso: cd /opt/zapmass && bash deployment/fix-evolution-image-vps.sh && bash deployment/manual-pull-deploy.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
FIX_IMAGE="${EVOLUTION_IMAGE:-evoapicloud/evolution-api:v2.3.7}"

cd "$ROOT"
if [ ! -f "$ENV" ]; then
  echo "Erro: $ENV nao encontrado." >&2
  exit 1
fi

if grep -qE '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_IMAGE=' "$ENV"; then
  sed -i -E "s|^([[:space:]]*export[[:space:]]+)?EVOLUTION_IMAGE=.*|\\1EVOLUTION_IMAGE=${FIX_IMAGE}|" "$ENV"
else
  printf '\nEVOLUTION_IMAGE=%s\n' "$FIX_IMAGE" >> "$ENV"
fi

if ! grep -qE '^[[:space:]]*(export[[:space:]]+)?WPP_LID_MODE=' "$ENV"; then
  printf 'WPP_LID_MODE=false\n' >> "$ENV"
fi

echo "==> EVOLUTION_IMAGE=${FIX_IMAGE}"
echo "==> Execute: bash deployment/manual-pull-deploy.sh"
