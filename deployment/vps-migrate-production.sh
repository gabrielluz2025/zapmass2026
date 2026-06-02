#!/usr/bin/env bash
# Migração completa Firebase → Postgres na VPS (produção).
# Uso: cd /opt/zapmass && bash deployment/vps-migrate-production.sh
#      bash deployment/vps-migrate-production.sh --dry-run
set -euo pipefail
cd /opt/zapmass

echo "=============================================="
echo " ZapMass — migração Firestore → Postgres"
echo "=============================================="

chmod +x deployment/*.sh 2>/dev/null || true

echo ""
echo "==> 1/4 Atualizar código"
bash deployment/ensure-git-main.sh

echo ""
echo "==> 2/4 Variáveis .env (dual auth + dados VPS)"
bash deployment/vps-migrate-env.sh

# Produção: manter login Google/Facebook até fase seguinte
upsert_env() {
  local k="$1" v="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env 2>/dev/null; then
    grep -vE "^[[:space:]]*(export[[:space:]]+)?${k}=" .env > .env.tmp && mv .env.tmp .env
  fi
  echo "${k}=${v}" >> .env
  echo "    ~ ${k}"
}
upsert_env ZAPMASS_AUTH_PROVIDER dual
upsert_env VITE_USE_VPS_AUTH false
upsert_env VITE_USE_VPS_DATA true

echo ""
echo "==> 3/4 Deploy (rebuild com VITE_USE_VPS_DATA)"
bash deployment/manual-pull-deploy.sh

echo ""
echo "==> 4/4 Executar migração de dados"
EXTRA_ARGS=("$@")
docker compose exec -T zapmass npx tsx server/migrateFirestoreToVps.ts "${EXTRA_ARGS[@]}"

echo ""
bash deployment/vps-check-env.sh
echo ""
echo "Migração concluída. Teste login (Google/e-mail) e assinatura em ${PUBLIC_APP_URL:-https://zap-mass.com}"
