#!/usr/bin/env bash
# Corrige donos dos chips na VPS (Sylvester → conta Sylvester; órfãos Firebase → festaimport).
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

echo "==> 1) Reparo automático de ownerUid"
bash deployment/repair-connection-owners.sh --auto --apply

echo "==> 2) Deploy (se ainda não fez) + reiniciar API"
if git rev-parse HEAD 2>/dev/null | grep -q .; then
  echo "    commit local: $(git rev-parse --short HEAD)"
fi
docker restart zapmass-zapmass-1

echo "==> 3) Conferir donos (duplicados Zap-mass saem ao abrir o painel — sync automático)"
sleep 6
bash deployment/diagnose-connection-owners.sh

echo ""
echo "OK. Faça logout/login (Ctrl+Shift+R) em CADA conta:"
echo "  - festaimportgabriel@gmail.com"
echo "  - sylvesterstallonealvesdasilva@gmail.com"
echo "  - gabrielfestaimport@gmail.com"
echo "Cada uma deve ver SOMENTE os seus chips."
