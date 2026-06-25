#!/usr/bin/env bash
# =============================================================================
# ZAPMASS — DEPLOY COMPLETO (um comando só)
# =============================================================================
# Faz TUDO numa execução:
#   1. Alinha o código com origin/main (git fetch + reset)
#   2. Corrige .env legado (REDIS_URL) se necessário
#   3. Build Docker + sobe stack/compose (instância principal)
#   4. Atualiza TODOS os containers de clientes (Plano B), se existirem
#   5. Healthcheck /api/health + recuperação automática se a API cair
#
# USO (cole na VPS — SSH ou terminal Hostinger):
#
#   cd /opt/zapmass && bash deployment/deploy-completo.sh
#
# Se outro deploy estiver preso no lock (>10 min):
#   DEPLOY_FORCE=1 cd /opt/zapmass && bash deployment/deploy-completo.sh
#
# Sem atualizar clientes (só instância principal) — edite vps-deploy.sh ou use:
#   (não suportado neste script único; clientes são atualizados junto com a principal)
#
# Primeira vez / repo sem scripts novos — baixar e executar:
#   curl -fsSL https://raw.githubusercontent.com/gabrielluz2025/zapmass2026/main/deployment/deploy-completo.sh | bash -s
# =============================================================================
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
DEPLOY_DIR="${ROOT}/deployment"

log() { echo ""; echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

if [ ! -d "$ROOT" ]; then
  die "Pasta ${ROOT} não existe. Clone o repo em /opt/zapmass primeiro."
fi

cd "$ROOT"

# --- Git: código = origin/main ---
log "1/4 — Atualizar código (origin/main)"
if [ -f deployment/ensure-git-main.sh ]; then
  bash deployment/ensure-git-main.sh
elif [ -d .git ]; then
  git fetch origin
  git checkout -f main 2>/dev/null || git checkout -B main origin/main
  git reset --hard origin/main
  echo "==> commit $(git rev-parse --short HEAD)"
else
  die "Sem repositório git em ${ROOT}"
fi

# --- Permissões + pull seguro em scripts de deploy ---
chmod +x deployment/*.sh 2>/dev/null || true
chmod +x deployment/clientes/scripts/*.sh 2>/dev/null || true

if [ -f deployment/vps-safe-pull.sh ]; then
  # Só corrige REDIS_URL legado; não faz segundo pull (ensure-git-main já alinhou).
  if [ -f .env ] && grep -qE '^REDIS_URL=.*(host\.docker\.internal|localhost|127\.0\.0\.1)' .env 2>/dev/null; then
    log "A corrigir REDIS_URL no .env (legado Swarm)"
    sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|' .env
  fi
fi

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
log "Código em main @ ${COMMIT}"

# --- Já em produção? (evita deploy duplicado quando CI/cron acabou de aplicar) ---
HP="$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')" || true
HP="${HP:-3001}"
LIVE_VER="$(curl -sf "http://127.0.0.1:${HP}/api/health" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || echo '')"
if [ -n "${LIVE_VER}" ] && [ "${LIVE_VER}" = "${COMMIT}" ]; then
  log "4/4 — Já em produção @ ${COMMIT} (nada a fazer)"
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Servidor já está na versão ${COMMIT}                          "
  echo "║  API: http://127.0.0.1:${HP}/api/health                          "
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 0
fi

# --- Lock: outro deploy (CI/cron) em paralelo ---
if [ "${DEPLOY_FORCE:-0}" = "1" ]; then
  log "DEPLOY_FORCE=1 — aguardar deploy em andamento ou limpar lock"
  bash deployment/wait-for-deploy-lock.sh || bash deployment/clear-stale-deploy-lock.sh || true
  LIVE_VER="$(curl -sf "http://127.0.0.1:${HP}/api/health" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || echo '')"
  if [ -n "${LIVE_VER}" ] && [ "${LIVE_VER}" = "${COMMIT}" ]; then
    log "4/4 — Outro deploy aplicou ${COMMIT} enquanto aguardávamos"
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  Servidor já está na versão ${COMMIT}                          "
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    exit 0
  fi
fi

# --- .env mínimo ---
if [ ! -f .env ] && [ -f .env.example ]; then
  log "A criar .env a partir de .env.example"
  cp .env.example .env
fi

# --- Deploy principal + clientes + health (vps-deploy.sh) ---
log "2/4 — Build e deploy Docker (principal + clientes)"
log "3/4 — Aguardar healthcheck da API"

if [ ! -f deployment/vps-deploy.sh ]; then
  die "deployment/vps-deploy.sh não encontrado — confira git pull / branch main"
fi

chmod +x deployment/vps-deploy.sh

export VITE_GIT_REF="${COMMIT}"
export DEPLOY_FLOCK_WAIT_SEC="${DEPLOY_FLOCK_WAIT_SEC:-900}"
# Não simular GitHub Actions — evita pausa de 90s antes do healthcheck em deploy manual.
unset GITHUB_EVENT_NAME
unset GITHUB_ACTIONS

bash deployment/vps-deploy.sh
_DEPLOY_RC=$?

if [ "${_DEPLOY_RC}" -ne 0 ]; then
  log "4/4 — FALHA no deploy (exit ${_DEPLOY_RC})"
  echo ""
  echo "Tente:"
  echo "  DEPLOY_FORCE=1 cd ${ROOT} && bash deployment/deploy-completo.sh"
  echo "  cd ${ROOT} && bash deployment/SOS-API-FORA.sh"
  echo "  bash deployment/deploy-lock-diagnose.sh"
  exit "${_DEPLOY_RC}"
fi

log "4/4 — SUCESSO"
HP="$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')" || true
HP="${HP:-3001}"
VER="$(curl -sf "http://127.0.0.1:${HP}/api/version" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || echo '?')"
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Deploy completo OK                                          ║"
echo "║  Commit: ${COMMIT}   API: http://127.0.0.1:${HP}/api/health          ║"
echo "║  Versão live: ${VER}                                          "
echo "║  Validação: bash deployment/validate-post-deploy.sh          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
