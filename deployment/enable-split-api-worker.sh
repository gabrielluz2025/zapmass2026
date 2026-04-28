#!/usr/bin/env bash
# Activa modo separado (API HTTP + whatsapp-worker com Chromium): útil quando queres aliviar RAM/CPU na API.
# Corre na VPS, em /opt/zapmass, com permissões para gravar `.env`:
#   cd /opt/zapmass && bash deployment/enable-split-api-worker.sh
#
# Isto apenas acrescenta (ou sugere edição manual) estas variáveis; o redesploy é igual ao habitual:
#   bash deployment/manual-pull-deploy.sh
#
# Requisitos já previstos no docker-stack.yml: Redis; `STACK` exporta estas vars do `.env`.
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

if [[ ! -f .env ]]; then
  touch .env
  echo "==> criado .env em ${ROOT}"
fi

bak=".env.backup.enable-split.$(date -u +%Y%m%d_%H%M%S)"
cp -a .env "${bak}"
echo "==> backup: ${bak}"

# Alguma linha activa (não só comentada) já define modo ou replicas?
has_mode_line() {
  grep -Eq '^[[:space:]]*ZAPMASS_API_SESSION_MODE[[:space:]]*=' .env 2>/dev/null
}
has_replicas_line() {
  grep -Eq '^[[:space:]]*WA_WORKER_REPLICAS[[:space:]]*=' .env 2>/dev/null
}

if has_mode_line || has_replicas_line; then
  echo "==> JA ha ZAPMASS_API_SESSION_MODE ou WA_WORKER_REPLICAS numa linha nao-comentada no .env."
  echo "    Ajuste manualmente para o modo pretendido:"
  echo "      ZAPMASS_API_SESSION_MODE=api"
  echo "      WA_WORKER_REPLICAS=1"
  echo "    Depois: bash deployment/manual-pull-deploy.sh"
  exit 0
fi

{
  echo ""
  echo "# --- enable-split-api-worker $(date -u +%Y-%m-%dT%H:%MZ) ---"
  echo "# API sem Chromium no serviço api; sessões WhatsApp no serviço wa-worker."
  echo "ZAPMASS_API_SESSION_MODE=api"
  echo "WA_WORKER_REPLICAS=1"
} >> .env

echo "==> Adicionadas ao fim do .env:"
echo "       ZAPMASS_API_SESSION_MODE=api"
echo "       WA_WORKER_REPLICAS=1"
echo "==> Rode o deploy: bash deployment/manual-pull-deploy.sh"
