#!/usr/bin/env bash
# =============================================================================
# Evolution API — atualizar imagem + deploy completo ZapMass (um comando)
# =============================================================================
#
# Versões (Docker Hub: evoapicloud/evolution-api):
#   v2.3.7        — última ESTÁVEL (sem licença; recomendada produção)
#   2.4.0-rc2     — mais recente (RC); exige ativação de licença gratuita
#                   https://docs.evolutionfoundation.com.br/licensing
#
# USO na VPS (SSH / terminal Hostinger):
#
#   # Estável (padrão — mesma linha do stack atual):
#   cd /opt/zapmass && bash deployment/upgrade-evolution-latest.sh
#
#   # Mais recente (2.4 RC + licença):
#   cd /opt/zapmass && EVOLUTION_IMAGE_TARGET=evoapicloud/evolution-api:2.4.0-rc2 bash deployment/upgrade-evolution-latest.sh
#
#   # Só atualizar .env + pull da imagem (sem rebuild ZapMass):
#   RUN_ZAPMASS_DEPLOY=0 bash deployment/upgrade-evolution-latest.sh
#
# =============================================================================
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
# Padrão: última estável. Para RC: export EVOLUTION_IMAGE_TARGET=evoapicloud/evolution-api:2.4.0-rc2
TARGET_IMAGE="${EVOLUTION_IMAGE_TARGET:-evoapicloud/evolution-api:v2.3.7}"
RUN_ZAPMASS_DEPLOY="${RUN_ZAPMASS_DEPLOY:-1}"

log() { echo ""; echo "==> $*"; }

cd "$ROOT"
if [ ! -f "$ENV" ]; then
  echo "ERRO: $ENV não encontrado." >&2
  exit 1
fi

log "1/4 — Código (origin/main)"
if [ -d .git ]; then
  if [ -f deployment/ensure-git-main.sh ]; then
    bash deployment/ensure-git-main.sh
  else
    git fetch origin main
    git checkout -f main 2>/dev/null || git checkout -B main origin/main
    git reset --hard origin/main
  fi
  echo "    commit $(git rev-parse --short HEAD)"
fi

log "2/4 — .env (EVOLUTION_IMAGE + WPP_LID_MODE)"
cp -a "$ENV" "${ENV}.bak.evo-upgrade.$(date +%Y%m%d%H%M%S)"

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

echo "    EVOLUTION_IMAGE=${TARGET_IMAGE}"
echo "    WPP_LID_MODE=false"

if echo "$TARGET_IMAGE" | grep -qE '2\.4\.0-rc|rc[0-9]'; then
  echo ""
  echo "⚠️  Evolution 2.4 RC: ative a licença gratuita após o deploy (manager ou EVOLUTION_OPERATOR_EMAIL)."
  echo "    https://docs.evolutionfoundation.com.br/licensing"
fi

log "3/4 — docker pull ${TARGET_IMAGE}"
if ! docker pull "$TARGET_IMAGE"; then
  echo "ERRO: tag não encontrada: ${TARGET_IMAGE}" >&2
  echo "Use: EVOLUTION_IMAGE_TARGET=evoapicloud/evolution-api:v2.3.7" >&2
  exit 1
fi

if [ "$RUN_ZAPMASS_DEPLOY" = "0" ]; then
  log "4/4 — SKIP deploy ZapMass (RUN_ZAPMASS_DEPLOY=0)"
  echo ""
  echo "Para subir stack: cd ${ROOT} && bash deployment/deploy-completo.sh"
  exit 0
fi

log "4/4 — Deploy completo ZapMass (stack + evolution + healthcheck)"
chmod +x deployment/*.sh 2>/dev/null || true
bash deployment/deploy-completo.sh

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Evolution atualizada: ${TARGET_IMAGE}"
echo "║  Verifique: curl -s http://127.0.0.1:8080/ | head -c 120"
echo "║  Chips podem precisar novo QR em Conexões após upgrade maior."
echo "╚══════════════════════════════════════════════════════════════╝"
