#!/usr/bin/env bash
# Garante operação 100% na VPS (auth + dados Postgres), sem Firebase/dual nem API local.
#
# Verificar:
#   cd /opt/zapmass && bash deployment/ensure-vps-only-mode.sh
#
# Aplicar .env + redeploy:
#   cd /opt/zapmass && APPLY=1 bash deployment/ensure-vps-only-mode.sh
#
# Modo completo (igual vps-pure-no-firebase, opcional reset):
#   cd /opt/zapmass && bash deployment/vps-pure-no-firebase.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

upsert_env() {
  local k="$1" v="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env 2>/dev/null; then
    grep -vE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env > .env.tmp && mv .env.tmp .env
  fi
  echo "${k}=${v}" >> .env
}

read_env() {
  grep -E "^[[:space:]]*${1}=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'"'"' ' | tr '[:upper:]' '[:lower:]' || true
}

echo "=============================================="
echo " ZapMass — verificação modo 100% VPS"
echo "=============================================="
[ -f .env ] || { echo "ERRO: .env ausente em ${ROOT}"; exit 1; }

AUTH="$(read_env ZAPMASS_AUTH_PROVIDER)"
DATA="$(read_env ZAPMASS_DATA_PROVIDER)"
PUBLIC="$(grep -E '^PUBLIC_APP_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'"'"' ' || true)"
HOST_PORT="$(read_env HOST_PORT)"
HOST_PORT="${HOST_PORT:-3001}"

issues=0
warn() { echo "  ⚠ $1"; issues=$((issues + 1)); }
ok() { echo "  ✓ $1"; }

echo ""
echo "==> Variáveis (.env)"
if [ "$AUTH" = "vps" ]; then ok "ZAPMASS_AUTH_PROVIDER=vps"; else warn "ZAPMASS_AUTH_PROVIDER=${AUTH:-vazio} (esperado: vps)"; fi
if [ "$DATA" = "vps" ]; then ok "ZAPMASS_DATA_PROVIDER=vps"; else warn "ZAPMASS_DATA_PROVIDER=${DATA:-vazio} (esperado: vps)"; fi
if [ -n "$PUBLIC" ] && echo "$PUBLIC" | grep -qiE 'localhost|127\.0\.0\.1'; then
  warn "PUBLIC_APP_URL aponta para localhost — use o domínio HTTPS da VPS"
else
  ok "PUBLIC_APP_URL=${PUBLIC:-(não definido — confira ALLOWED_ORIGINS)}"
fi

if [ "${APPLY:-0}" = "1" ]; then
  echo ""
  echo "==> Aplicando modo VPS no .env"
  upsert_env ZAPMASS_AUTH_PROVIDER vps
  upsert_env ZAPMASS_DATA_PROVIDER vps
  upsert_env VITE_USE_VPS_AUTH true
  upsert_env VITE_USE_VPS_DATA true
  upsert_env ZAPMASS_ENFORCE_VPS_ONLY 1
  export VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "==> Deploy (rebuild embute VITE_* no bundle)"
  bash deployment/manual-pull-deploy.sh
  issues=0
fi

echo ""
echo "==> API local (container)"
if curl -sf "http://127.0.0.1:${HOST_PORT}/api/health" -o /tmp/zm-health.json 2>/dev/null; then
  VPS_ONLY="$(grep -o '"vpsOnly":[^,}]*' /tmp/zm-health.json | cut -d: -f2 || echo false)"
  VER="$(grep -o '"version":"[^"]*"' /tmp/zm-health.json | cut -d'"' -f4 || echo ?)"
  if [ "$VPS_ONLY" = "true" ]; then
    ok "/api/health vpsOnly=true (versão ${VER})"
  else
    warn "/api/health vpsOnly=${VPS_ONLY} — auth/dados ainda não são 100% VPS"
  fi
else
  warn "Não respondeu em 127.0.0.1:${HOST_PORT}/api/health (stack parado?)"
fi

echo ""
echo "==> Notebook / browser"
echo "  • Use só o site HTTPS da VPS (não abra localhost:5173/8000 para operar)."
echo "  • Não precisa rodar npm run dev no PC para campanhas ou WhatsApp."
echo "  • Exceção leve: preferências de UI (pin/arquivo) ficam no localStorage do browser."
echo "  • Mensagem agendada no chat só dispara com a aba aberta (até migrarmos para fila no servidor)."

echo ""
if [ "$issues" -gt 0 ] && [ "${APPLY:-0}" != "1" ]; then
  echo "==> Corrigir automaticamente:"
  echo "    cd ${ROOT} && APPLY=1 bash deployment/ensure-vps-only-mode.sh"
  echo "  ou modo completo:"
  echo "    bash deployment/vps-pure-no-firebase.sh"
  exit 1
fi

echo "==> OK — operação centralizada na VPS."
exit 0
