#!/usr/bin/env bash
# Corrige donos dos chips na VPS (Sylvester → conta Sylvester; órfãos Firebase → festaimport).
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

echo "==> 1) Reparo automático de ownerUid"
bash deployment/repair-connection-owners.sh --auto --apply

echo "==> 2) Reiniciar API"
docker restart zapmass-zapmass-1

echo "==> 3) Conferir"
sleep 5
bash deployment/diagnose-connection-owners.sh

echo ""
echo "OK. Faça logout/login no painel (Ctrl+Shift+R) em cada conta."
