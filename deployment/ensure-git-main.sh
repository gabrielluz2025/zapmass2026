#!/usr/bin/env bash
# Repoe o ramo `main` a seguir a `origin/main` (apos deploy por commit o repo fica em detached HEAD
# e `git pull` pede "specify which branch"). Uso: cd /opt/zapmass && bash deployment/ensure-git-main.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Erro: $ROOT nao e um repositorio git." >&2
  exit 1
fi

# Fetch com refspec explícito para garantir que refs/remotes/origin/main seja atualizado
git fetch origin +refs/heads/main:refs/remotes/origin/main

if ! git show-ref -q --verify refs/remotes/origin/main; then
  echo "Erro: origin/main nao encontrado apos fetch. Confira: git remote -v" >&2
  exit 1
fi

ORIGIN_HASH=$(git rev-parse --short refs/remotes/origin/main 2>/dev/null || echo '?')
ORIGIN_MSG=$(git log -1 --pretty=format:%s refs/remotes/origin/main 2>/dev/null | head -c 80)
echo "==> origin/main apos fetch: ${ORIGIN_HASH} ${ORIGIN_MSG}"

# Descarta alterações locais + alinha com origin/main
# Funciona em detached HEAD, branch diferente ou branch main desatualizada
git checkout -f -B main refs/remotes/origin/main
git reset --hard refs/remotes/origin/main

LOCAL_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
echo "==> Agora em main @ ${LOCAL_HASH} (origin/main = ${ORIGIN_HASH})"
if [[ "$LOCAL_HASH" != "$ORIGIN_HASH" ]]; then
  echo "AVISO: HEAD (${LOCAL_HASH}) difere de origin/main (${ORIGIN_HASH}) — relatorio apenas, nao e erro." >&2
fi
