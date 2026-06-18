#!/usr/bin/env bash
# Atalho para deploy-completo.sh (mantido por compatibilidade).
# Uso: cd /opt/zapmass && bash deployment/manual-pull-deploy.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
exec bash deployment/deploy-completo.sh
