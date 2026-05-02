#!/usr/bin/env bash
# Idempotente: garante ZAPMASS_API_SESSION_MODE=api e WA_WORKER_REPLICAS=1 no .env da VPS.
# Uso (root na VPS): cd /opt/zapmass && bash deployment/ensure-split-env-on-vps.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
cd "$ROOT"
if [ ! -f "$ENV" ]; then
  echo "Erro: nao existe $ENV" >&2
  exit 1
fi

bak="${ENV}.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$ENV" "$bak"
echo "==> Backup: $bak"

tmp="$(mktemp)"
cp -a "$ENV" "$tmp"

if grep -qE '^[[:space:]]*(export[[:space:]]+)?ZAPMASS_API_SESSION_MODE=' "$tmp"; then
  sed -i -E 's/^([[:space:]]*export[[:space:]]+)?ZAPMASS_API_SESSION_MODE=.*/ZAPMASS_API_SESSION_MODE=api/' "$tmp"
else
  printf '\n# Zapmass: API + wa-worker (split)\nZAPMASS_API_SESSION_MODE=api\n' >> "$tmp"
fi

if grep -qE '^[[:space:]]*(export[[:space:]]+)?WA_WORKER_REPLICAS=' "$tmp"; then
  sed -i -E 's/^([[:space:]]*export[[:space:]]+)?WA_WORKER_REPLICAS=.*/WA_WORKER_REPLICAS=1/' "$tmp"
else
  printf 'WA_WORKER_REPLICAS=1\n' >> "$tmp"
fi

mv "$tmp" "$ENV"
echo "==> OK: $ENV — ZAPMASS_API_SESSION_MODE=api e WA_WORKER_REPLICAS=1"
echo "==> Reinicie o stack: bash deployment/manual-pull-deploy.sh"
