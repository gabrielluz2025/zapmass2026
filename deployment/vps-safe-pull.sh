#!/usr/bin/env bash
# Pull seguro em /opt/zapmass quando há alterações locais em scripts de deploy.
# Uso: cd /opt/zapmass && bash deployment/vps-safe-pull.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

_reset_if_dirty() {
  local f="$1"
  if git diff --quiet "$f" 2>/dev/null && git diff --cached --quiet "$f" 2>/dev/null; then
    return 0
  fi
  echo "==> descartando alteração local (repo prevalece): $f"
  git checkout -- "$f"
}

for f in deployment/vps-deploy.sh deployment/manual-pull-deploy.sh; do
  [ -f "$f" ] && _reset_if_dirty "$f"
done

echo "==> git pull origin main"
git pull --ff-only origin main
echo "==> commit: $(git rev-parse --short HEAD)"

# Compose: garantir REDIS_URL correta (legado Swarm host.docker.internal)
if [ -f .env ] && grep -qE '^REDIS_URL=.*(host\.docker\.internal|localhost|127\.0\.0\.1)' .env 2>/dev/null; then
  echo "==> corrigindo REDIS_URL no .env"
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|' .env
fi

echo "==> OK — agora: docker compose up -d --build zapmass"
