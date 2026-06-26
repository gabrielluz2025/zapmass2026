#!/usr/bin/env bash
# =============================================================================
# VPS — um comando: git + Evolution + deploy + .env key + validação
# =============================================================================
#
# Cole na VPS:
#   cd /opt/zapmass && bash deployment/ensure-git-main.sh && bash deployment/vps-pos-deploy-completo.sh
#
# Forçar rebuild mesmo na mesma versão:
#   DEPLOY_FORCE=1 bash deployment/vps-pos-deploy-completo.sh
# =============================================================================
set -eu

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

log() { echo ""; echo "==> $*"; }
ok()  { echo "  OK: $*"; }
warn() { echo "  AVISO: $*"; }

log "1/6 — Git (origin/main)"
if [ -f deployment/ensure-git-main.sh ]; then
  bash deployment/ensure-git-main.sh
else
  git fetch origin main
  git checkout -f main 2>/dev/null || true
  git reset --hard origin/main
fi
echo "  commit $(git rev-parse --short HEAD)"

log "2/6 — EVOLUTION_API_KEY no .env (alinhar com container ou padrão)"
DEFAULT_KEY="${DEFAULT_EVOLUTION_KEY:-zapmass-secure-key-2026}"
_evo_cid="$(docker compose ps -q evolution 2>/dev/null | head -1 || true)"
_key="$DEFAULT_KEY"
if [ -n "$_evo_cid" ]; then
  _key="$(docker exec "$_evo_cid" printenv AUTHENTICATION_API_KEY 2>/dev/null || echo "$DEFAULT_KEY")"
fi
if grep -qE '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null; then
  sed -i -E "s|^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=.*|EVOLUTION_API_KEY=${_key}|" .env
else
  echo "EVOLUTION_API_KEY=${_key}" >> .env
fi
ok "EVOLUTION_API_KEY=${_key:0:12}…"
unset _evo_cid _key DEFAULT_KEY

log "3/6 — Evolution + Postgres + Redis (Compose)"
chmod +x deployment/fix-evolution-now.sh deployment/recover-postgres-evolution.sh 2>/dev/null || true
bash deployment/fix-evolution-now.sh || bash deployment/recover-postgres-evolution.sh

log "4/6 — Deploy completo ZapMass"
if [ "${DEPLOY_FORCE:-0}" = "1" ]; then
  export DEPLOY_FORCE=1
fi
bash deployment/deploy-completo.sh

log "5/6 — Aguardar Evolution fetchInstances (até ~30s)"
KEY="$(docker exec zapmass-evolution-1 printenv AUTHENTICATION_API_KEY 2>/dev/null || grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2- | tr -d $'\r"')"
_http="000"
for i in 1 2 3 4 5 6; do
  _http="$(curl -s -o /tmp/zapmass-evo-check.json -w '%{http_code}' \
    -H "apikey: ${KEY}" "http://127.0.0.1:8080/instance/fetchInstances" 2>/dev/null || echo 000)"
  if [ "$_http" = "200" ]; then
    ok "fetchInstances HTTP 200"
    head -c 400 /tmp/zapmass-evo-check.json 2>/dev/null || true
    echo ""
    break
  fi
  echo "  tentativa ${i}/6: HTTP ${_http}"
  sleep 5
done
if [ "$_http" != "200" ]; then
  warn "fetchInstances ainda não 200 — veja logs: docker compose logs evolution --tail 40"
fi
unset _http i KEY

log "6/6 — Validação pós-deploy"
bash deployment/validate-post-deploy.sh

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Fim. No navegador: Bate-papo → ↻ Sincronizar + Ctrl+Shift+R ║"
echo "╚══════════════════════════════════════════════════════════════╝"
