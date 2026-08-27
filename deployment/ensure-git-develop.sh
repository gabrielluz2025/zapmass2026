#!/usr/bin/env bash
# Repoe o ramo `develop` a seguir a `origin/develop` (homolog deploya desta branch).
# Descarta alterações locais em ficheiros rastreados — evita "would be overwritten by checkout".
# Uso: cd /opt/zapmass && bash deployment/ensure-git-develop.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Erro: $ROOT nao e um repositorio git." >&2
  exit 1
fi
git fetch origin
echo "==> origin/develop apos fetch: $(git rev-parse --short refs/remotes/origin/develop 2>/dev/null) $(git log -1 --pretty=format:%s refs/remotes/origin/develop 2>/dev/null | head -c 80)"
if ! git show-ref -q --verify refs/remotes/origin/develop; then
  echo "Erro: origin/develop nao encontrado. Confira: git remote -v" >&2
  exit 1
fi
if git show-ref -q --verify refs/heads/develop; then
  git checkout -f develop
else
  git checkout -b develop origin/develop
fi
git reset --hard origin/develop
echo "==> Agora em develop @ $(git rev-parse --short HEAD) (igual a origin/develop)."
