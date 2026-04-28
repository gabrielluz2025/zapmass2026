#!/usr/bin/env bash
# Deploy manual na VPS quando o GitHub Actions nao consegue SSH (timeout na porta 22).
# Abra uma sessao SSH pelo seu PC (ou terminal browser do painel) e execute:
#   cd /opt/zapmass && bash deployment/manual-pull-deploy.sh
#
# Isto alinha `main` com `origin/main` e corre o mesmo fluxo que deployment/vps-deploy.sh
# (Docker / Swarm + healthcheck).
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
echo "==> manual-pull-deploy: ${ROOT}"
bash deployment/ensure-git-main.sh
chmod +x deployment/vps-deploy.sh
exec bash deployment/vps-deploy.sh
