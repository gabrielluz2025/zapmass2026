#!/usr/bin/env bash
# Alinha /opt/zapmass com origin/main (descarta alterações locais em ficheiros rastreados).
# Uso na VPS: cd /opt/zapmass && bash deployment/sync-with-origin.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
git fetch origin
if ! git show-ref -q --verify refs/remotes/origin/main; then
  echo "Erro: origin/main inexistente." >&2
  exit 1
fi
if git show-ref -q --verify refs/heads/main; then
  git checkout -f main
else
  git checkout -b main origin/main
fi
git reset --hard origin/main
echo "OK: main == origin/main @ $(git rev-parse --short HEAD)"
