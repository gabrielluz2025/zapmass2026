#!/usr/bin/env bash
# Deploy manual na VPS quando o GitHub Actions nao consegue SSH (timeout na porta 22).
# Abra uma sessao SSH pelo seu PC (ou terminal browser do painel) e execute:
#   cd /opt/zapmass && bash deployment/manual-pull-deploy.sh
#
# Se git pull falhar por alteração local em deployment/vps-deploy.sh:
#   cd /opt/zapmass && git checkout -- deployment/vps-deploy.sh && git pull origin main
#   ou: bash deployment/vps-safe-pull.sh
# Se ficar "aguardando lock" 10 min e falhar:
#   bash deployment/deploy-lock-diagnose.sh
#   bash deployment/clear-stale-deploy-lock.sh   # só se não houver deploy ativo
#   bash deployment/manual-pull-deploy.sh
#
# Isto alinha `main` com `origin/main` e corre o mesmo fluxo que deployment/vps-deploy.sh
# (Docker / Swarm + healthcheck).
#
# Opcional — modo API + wa-worker com Chromium só no worker (ver .env.example):
#   bash deployment/enable-split-api-worker.sh && bash deployment/manual-pull-deploy.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
echo "==> manual-pull-deploy: ${ROOT}"
bash deployment/ensure-git-main.sh
chmod +x deployment/vps-deploy.sh
exec bash deployment/vps-deploy.sh
