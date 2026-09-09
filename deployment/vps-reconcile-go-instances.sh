#!/usr/bin/env bash
# Reconcilia instâncias Evolution Go ↔ ZapMass na VPS (limpa órfãs, duplicatas UUID).
# Uso:
#   cd /opt/zapmass && bash deployment/vps-reconcile-go-instances.sh
#   DRY_RUN=1 bash deployment/vps-reconcile-go-instances.sh   # só lista, não apaga
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

log() { echo "==> $*"; }

detect_whatsapp_engine() {
  local engine
  engine="$(grep -E '^[[:space:]]*(export[[:space:]]+)?ZAPMASS_WHATSAPP_ENGINE=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?ZAPMASS_WHATSAPP_ENGINE=//' | tr -d '\r"' \
    | sed 's/^["'\'']//;s/["'\'']$//' || true)"
  engine="${engine:-${ZAPMASS_WHATSAPP_ENGINE:-evolution-go}}"
  printf '%s' "$(echo "$engine" | tr '[:upper:]' '[:lower:]')"
}

ENGINE="$(detect_whatsapp_engine)"
case "$ENGINE" in
  evolution-go | go | evogo) ;;
  *)
    log "Motor ${ENGINE} — reconciler Go só aplica com evolution-go."
    log "Use: bash deployment/vps-cleanup-evolution-instances.sh"
    exit 0
    ;;
esac

HP="$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')" || true
HP="${HP:-3001}"

log "1/3 — Varredura drift (script VPS + lista Go)"
bash deployment/vps-cleanup-evolution-instances.sh || true

log "2/3 — Health Evolution Go"
if [ -f deployment/check-evolution-go-health.sh ]; then
  bash deployment/check-evolution-go-health.sh || true
fi

log "3/3 — Reconciler via API (após container com v2.3.102+)"
LIVE_VER="$(curl -sf "http://127.0.0.1:${HP}/api/health" 2>/dev/null | sed -n 's/.*"appVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || echo '')"
log "Versão API live: ${LIVE_VER:-desconhecida}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  log "DRY_RUN=1 — limpeza Go via script concluída; reconciler API requer token admin."
  log "No painel Admin: POST /api/admin/go-instances/reconcile?dryRun=1"
  exit 0
fi

log "Reconciler automático na API roda a cada 15 min (GO_INSTANCE_RECONCILE_INTERVAL_MS)."
log "Após deploy, aguarde ~3 min do boot ou reinicie API: docker compose restart zapmass"
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Reconciliação VPS concluída                                  "
echo "║  Produção: bash deployment/deploy-completo.sh                 "
echo "║  Homolog:  bash deployment/vps-deploy-homolog.sh              "
echo "╚══════════════════════════════════════════════════════════════╝"
